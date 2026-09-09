import { createHash, randomUUID } from 'node:crypto';
import type {
  CommandContext, NoGuard, PolicyApplicationGuard, ProjectScope, RevisionGuard, SrScope,
} from '@/src/contracts/context';
import type { CommandResult, CurrentBasis, DomainError, ReviewImpact } from '@/src/contracts/results';
import type {
  PolicyApplication, PolicyApplicationResult, PolicyEdit, PolicyView,
  ReviewerAssignment, ReviewAssignmentView, ReviewBundleView,
} from '@/src/contracts/views';
import type { Persistence } from '@/src/persistence/transaction';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readCommandReceipt, storeCommandReceipt } from '@/src/persistence/command-receipts';
import { readMembership, readProjectRevision, readReviewBundles, readSrDetail, readSrView } from '@/src/persistence/sr-repository';
import {
  appendAssignment, appendPolicyVersion, readAssignment, readDefaultPolicyRef, readGateState,
  readPolicy, updateGateConfiguration,
} from '@/src/persistence/review-policy-repository';
import { affectedReviewGates, assessReviewerAssignment, validatePolicyEdit } from '@/src/domain/review-policy';
import { applyReviewConfigurationImpact } from '@/src/persistence/review-impact-repository';
import { captureCurrentReviewBundle } from './review-bundle-snapshot';

type PolicyCommand = CommandContext<ProjectScope, NoGuard>;
type AssignmentCommand = CommandContext<SrScope, RevisionGuard<'review_gate_state'>>;
type ApplicationCommand = CommandContext<SrScope, PolicyApplicationGuard>;

function error(code: DomainError['code'], message: string, current?: CurrentBasis): DomainError {
  return { code, message, ...(current === undefined ? {} : { current }), blockers: [], assigneeIds: [], targetRefs: [] };
}

function reject<T>(code: DomainError['code'], message: string, current?: CurrentBasis): CommandResult<T> {
  return { kind: 'Rejected', error: error(code, message, current) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new TypeError('정책 명령 입력은 JSON 값이어야 합니다.');
  return result;
}

function fingerprint(kind: string, ctx: PolicyCommand | AssignmentCommand | ApplicationCommand, input: unknown): string {
  return `sha256:${createHash('sha256').update(canonical({ schemaVersion: 1, commandKind: kind, scope: ctx.scope, guard: ctx.guard, input })).digest('hex')}`;
}

function actorIsAdmin(db: DatabaseConnection, ctx: PolicyCommand | AssignmentCommand | ApplicationCommand): boolean {
  if (ctx.actor.projectId !== ctx.scope.projectId) return false;
  return readMembership(db, ctx.scope.projectId, ctx.actor.actorId)?.roles.includes('team_admin') === true;
}

function actorCanAssignReviewers(
  db: DatabaseConnection,
  ctx: AssignmentCommand,
  sr: import('@/src/contracts/views').SRView,
): boolean {
  if (ctx.actor.projectId !== ctx.scope.projectId) return false;
  const membership = readMembership(db, ctx.scope.projectId, ctx.actor.actorId);
  if (membership === undefined) return false;
  if (membership.roles.includes('team_admin') || sr.ownerId === ctx.actor.actorId) return true;
  return readSrDetail(db, ctx.scope.projectId, ctx.scope.srId)?.originalDescription.authorId === ctx.actor.actorId;
}

function readReviewMemberships(db: DatabaseConnection, projectId: string) {
  const ids = db.prepare('SELECT user_id FROM demo_user_memberships WHERE project_id=? AND demo=1 ORDER BY user_id')
    .all(projectId) as Array<{ user_id: string }>;
  return ids.map(({ user_id: actorId }) => {
    const membership = readMembership(db, projectId, actorId);
    if (membership === undefined) throw new Error('프로젝트 membership을 읽는 중 row가 사라졌습니다.');
    return membership;
  });
}

function gateBasis(scope: SrScope, gate: 'G1' | 'G2', revision: number): CurrentBasis {
  return { target: { kind: 'review_gate_state', projectId: scope.projectId, srId: scope.srId, entityId: gate }, currentRevision: revision, allowedActions: [] };
}

function projectBasis(projectId: string, revision: number): CurrentBasis {
  return { target: { kind: 'project', projectId, entityId: projectId }, currentRevision: revision, allowedActions: [] };
}

function insertActivity(db: DatabaseConnection, input: {
  readonly projectId: string; readonly srId?: string; readonly actorId: string; readonly receiptId: string;
  readonly eventType: string; readonly occurredAt: string; readonly description: string; readonly refs: readonly object[];
}): void {
  db.prepare(`INSERT INTO activity_events(project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,occurred_at,receipt_id,internal_basis_json,description,payload_json)
    VALUES (?,?,?,?,'user',?,?,?, ?,NULL,?,'{}')`).run(
    input.projectId, `activity-${randomUUID()}`, input.srId ?? null, input.eventType,
    input.actorId, JSON.stringify(input.refs), input.occurredAt, input.receiptId, input.description,
  );
}

function receipt(ctx: PolicyCommand | AssignmentCommand | ApplicationCommand, kind: string, hash: string, committedRevision: number, refs: readonly object[], committedAt: string) {
  return {
    scope: ctx.scope, receiptId: `receipt-${randomUUID()}`,
    actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId }, commandKind: kind,
    requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash,
    committedRevision, resultRefs: refs as import('@/src/contracts/results').CommandReceipt['resultRefs'], committedAt,
  };
}

function validateGateGuard(ctx: AssignmentCommand, gate: 'G1' | 'G2', revision: number): boolean {
  const expected = ctx.guard.resource;
  return expected.target.kind === 'review_gate_state' && expected.target.projectId === ctx.scope.projectId &&
    expected.target.srId === ctx.scope.srId && expected.target.entityId === gate && expected.expectedRevision === revision;
}

function validateApplicationGuard(ctx: ApplicationCommand, gates: readonly ('G1' | 'G2')[], states: ReadonlyMap<string, number>): boolean {
  if (ctx.guard.resources.length !== gates.length) return false;
  const seen = new Set<string>();
  for (const item of ctx.guard.resources) {
    const gate = item.target.entityId;
    if (item.target.kind !== 'review_gate_state' || item.target.projectId !== ctx.scope.projectId || item.target.srId !== ctx.scope.srId ||
      (gate !== 'G1' && gate !== 'G2') || !gates.includes(gate) || seen.has(gate) || states.get(gate) !== item.expectedRevision) return false;
    seen.add(gate);
  }
  return seen.size === gates.length;
}

function assessedAssignment(db: DatabaseConnection, scope: SrScope, assignment: ReviewAssignmentView, policy: PolicyView): ReviewAssignmentView {
  const sr = readSrView(db, scope.projectId, scope.srId);
  if (sr === undefined) throw new Error('배정 대상 SR을 찾을 수 없습니다.');
  const memberships = readReviewMemberships(db, scope.projectId);
  const assessment = assessReviewerAssignment(assignment.reviewerIds, sr.ownerId, memberships, policy.gates[assignment.gate]);
  return { ...assignment, ready: assessment.ready, ...(assessment.reason === undefined ? {} : { notReadyReason: assessment.reason }) };
}

function replayAssignment(raw: unknown, stored: ReviewAssignmentView): ReviewAssignmentView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('배정 replay value가 객체가 아닙니다.');
  const value = raw as Record<string, unknown>;
  if (value.gate !== stored.gate || !Array.isArray(value.reviewerIds) || value.reviewerIds.some((id) => typeof id !== 'string') ||
    new Set(value.reviewerIds).size !== value.reviewerIds.length ||
    JSON.stringify([...value.reviewerIds].sort()) !== JSON.stringify([...stored.reviewerIds].sort()) || typeof value.ready !== 'boolean' ||
    (value.notReadyReason !== undefined && typeof value.notReadyReason !== 'string')) throw new Error('배정 replay value가 올바르지 않습니다.');
  return {
    assignmentRef: stored.assignmentRef, gate: stored.gate, reviewerIds: value.reviewerIds as string[],
    ready: value.ready, ...(typeof value.notReadyReason === 'string' ? { notReadyReason: value.notReadyReason } : {}),
  };
}

function replayPolicyApplication(
  db: DatabaseConnection,
  scope: SrScope,
  input: PolicyApplication,
  raw: unknown,
  resultRefs: import('@/src/contracts/results').CommandReceipt['resultRefs'],
): PolicyApplicationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('정책 적용 replay value가 객체가 아닙니다.');
  const source = raw as Record<string, unknown>;
  const rawGates = source.gates;
  const rawImpact = source.reviewImpact;
  if (!Array.isArray(rawGates) || typeof rawImpact !== 'object' || rawImpact === null || Array.isArray(rawImpact)) throw new Error('정책 적용 replay value가 올바르지 않습니다.');
  const impact = rawImpact as Record<string, unknown>;
  if (!Array.isArray(impact.affectedGates) || impact.affectedGates.some((gate) => gate !== 'G1' && gate !== 'G2') ||
    typeof impact.needsNewReview !== 'boolean' || !Array.isArray(impact.carriedBlockingRequestIds) || impact.carriedBlockingRequestIds.some((id) => typeof id !== 'string') ||
    typeof impact.currentHandoffValid !== 'boolean' || (impact.returnStage !== undefined && typeof impact.returnStage !== 'string')) throw new Error('정책 적용 replay reviewImpact가 올바르지 않습니다.');
  const decodedGates = rawGates.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('정책 적용 replay gate가 객체가 아닙니다.');
    const candidate = item as Record<string, unknown>;
    if ((candidate.gate !== 'G1' && candidate.gate !== 'G2') || !input.gates.includes(candidate.gate)) throw new Error('정책 적용 replay gate가 요청과 다릅니다.');
    return candidate;
  });
  if (new Set(decodedGates.map((item) => item.gate)).size !== input.gates.length || decodedGates.length !== input.gates.length) {
    throw new Error('정책 적용 replay gate 집합이 요청과 다릅니다.');
  }
  const bundles = readReviewBundles(db, scope.projectId, scope.srId);
  const gates = decodedGates.map((candidate) => {
    const gate = candidate.gate as 'G1' | 'G2';
    const result = candidate.result;
    if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('정책 적용 replay gate 결과가 없습니다.');
    const rawResult = result as Record<string, unknown>;
    const ref = resultRefs.find((item): item is import('@/src/contracts/context').BundleRef =>
      !('kind' in item) && item.gate === gate && item.projectId === scope.projectId && item.srId === scope.srId);
    if (ref !== undefined) {
      const bundle = bundles.find((item) => item.bundleRef.gate === ref.gate && item.bundleRef.bundleId === ref.bundleId && item.bundleRef.version === ref.version);
      if (bundle === undefined) throw new Error('정책 적용 replay bundle을 찾을 수 없습니다.');
      const storedRequestIds = (db.prepare('SELECT request_id FROM review_requests WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND bundle_version=? ORDER BY request_id')
        .all(scope.projectId, scope.srId, gate, ref.bundleId, ref.version) as Array<{ request_id: string }>).map((row) => row.request_id);
      if (rawResult.kind !== 'BundleAvailable' || !Array.isArray(rawResult.requestIds) ||
        rawResult.requestIds.some((id) => typeof id !== 'string') || new Set(rawResult.requestIds).size !== rawResult.requestIds.length ||
        JSON.stringify([...rawResult.requestIds].sort()) !== JSON.stringify([...storedRequestIds].sort())) {
        throw new Error('정책 적용 replay 검토 요청이 저장 상태와 다릅니다.');
      }
      return { gate, result: { kind: 'BundleAvailable' as const, bundle, requestIds: rawResult.requestIds as string[] } };
    }
    const value = rawResult;
    if (value.kind !== 'NeedsInputs' || value.gate !== gate || !Array.isArray(value.missing) || value.missing.some((item) => typeof item !== 'string') || !Array.isArray(value.assigneeIds) || value.assigneeIds.some((item) => typeof item !== 'string')) throw new Error('정책 적용 replay NeedsInputs가 올바르지 않습니다.');
    return { gate, result: { kind: 'NeedsInputs' as const, gate, missing: value.missing as string[], assigneeIds: value.assigneeIds as string[] } };
  });
  const first = gates[0];
  if (first === undefined) throw new Error('정책 적용 replay gate가 비었습니다.');
  const reviewImpact: ReviewImpact = {
    affectedGates: impact.affectedGates as ('G1' | 'G2')[], needsNewReview: impact.needsNewReview,
    ...(typeof impact.returnStage === 'string' ? { returnStage: impact.returnStage } : {}),
    carriedBlockingRequestIds: impact.carriedBlockingRequestIds as string[], currentHandoffValid: impact.currentHandoffValid,
  };
  return { policyRef: input.policyRef, gates: [first, ...gates.slice(1)], reviewImpact };
}

export interface ReviewPolicyService {
  createPolicyVersion(ctx: PolicyCommand, input: PolicyEdit): CommandResult<PolicyView>;
  assignReviewers(ctx: AssignmentCommand, input: ReviewerAssignment): CommandResult<ReviewAssignmentView>;
  applyPolicyToSr(ctx: ApplicationCommand, input: PolicyApplication): CommandResult<PolicyApplicationResult>;
}

export function createReviewPolicyService(
  persistence: Persistence,
  options: { readonly documentReviewMode?: boolean } = {},
): ReviewPolicyService {
  return {
    createPolicyVersion(ctx, input) {
      const validation = validatePolicyEdit(input);
      if (validation !== undefined) return reject('VALIDATION_ERROR', validation);
      const hash = fingerprint('M-029', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (!actorIsAdmin(db, ctx)) return reject('FORBIDDEN', '현재 팀 관리자만 정책을 변경할 수 있습니다.');
          const prior = readCommandReceipt<PolicyView>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            if (prior.receipt.commandKind !== 'M-029' || prior.receipt.inputFingerprint !== hash) return { kind: 'Rejected', error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: prior.receipt };
            const ref = prior.receipt.resultRefs.find((item): item is import('@/src/contracts/context').ReviewPolicyVersionRef =>
              'kind' in item && item.kind === 'review_policy' && 'version' in item);
            const value = ref === undefined ? undefined : readPolicy(db, ref);
            const revision = readProjectRevision(db, ctx.scope.projectId);
            if (value === undefined || revision === undefined) return reject('STORE_UNAVAILABLE', '정책 receipt를 안전하게 재생할 수 없습니다.');
            return { kind: 'Replayed', value, receipt: prior.receipt, current: projectBasis(ctx.scope.projectId, revision) };
          }
          const current = readDefaultPolicyRef(db, ctx.scope.projectId);
          const previous = 'previousPolicyRef' in input ? input.previousPolicyRef : undefined;
          if ((current === undefined) !== (previous === undefined) || (current !== undefined && previous !== undefined &&
            (current.entityId !== previous.entityId || current.version !== previous.version || previous.projectId !== ctx.scope.projectId))) {
            return reject('STALE_VERSION', '현재 기본 정책 버전이 바뀌었습니다.');
          }
          const now = new Date().toISOString();
          const value = appendPolicyVersion(db, { projectId: ctx.scope.projectId, actorId: ctx.actor.actorId, edit: input, createdAt: now });
          const revision = readProjectRevision(db, ctx.scope.projectId);
          if (revision === undefined) throw new Error('프로젝트 revision이 없습니다.');
          const saved = receipt(ctx, 'M-029', hash, revision, [value.policyRef], now);
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertActivity(db, { projectId: ctx.scope.projectId, actorId: ctx.actor.actorId, receiptId: saved.receiptId, eventType: 'review_policy_version_created', occurredAt: now, description: '기본 검토 정책 버전을 만들었습니다.', refs: [value.policyRef] });
          return { kind: 'Committed', value, receipt: saved };
        });
      } catch { return reject('STORE_UNAVAILABLE', '정책 변경을 확정하지 못했습니다.'); }
    },

    assignReviewers(ctx, input) {
      const hash = fingerprint('M-030', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return reject('NOT_FOUND', 'SR을 찾을 수 없습니다.');
          if (!actorCanAssignReviewers(db, ctx, sr)) return reject('FORBIDDEN', '현재 SR 등록자, 담당자 또는 팀 관리자만 검토자를 배정할 수 있습니다.');
          const prior = readCommandReceipt<ReviewAssignmentView>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            if (prior.receipt.commandKind !== 'M-030' || prior.receipt.inputFingerprint !== hash) return { kind: 'Rejected', error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: prior.receipt };
            const ref = prior.receipt.resultRefs.find((item): item is import('@/src/contracts/context').ReviewAssignmentRef =>
              'kind' in item && item.kind === 'review_assignment');
            const stored = ref === undefined ? undefined : readAssignment(db, ref);
            const state = readGateState(db, ctx.scope, input.gate);
            if (stored === undefined || state === undefined) return reject('STORE_UNAVAILABLE', '배정 receipt를 안전하게 재생할 수 없습니다.');
            const value = replayAssignment(prior.replayValue, stored);
            return { kind: 'Replayed', value, receipt: prior.receipt, current: gateBasis(ctx.scope, input.gate, state.revision) };
          }
          const state = readGateState(db, ctx.scope, input.gate);
          if (state === undefined) return reject('NOT_FOUND', '검토 단계를 찾을 수 없습니다.');
          if (!validateGateGuard(ctx, input.gate, state.revision)) return reject('STALE_VERSION', '검토 gate revision이 바뀌었습니다.', gateBasis(ctx.scope, input.gate, state.revision));
          const previous = 'previousAssignmentRef' in input ? input.previousAssignmentRef : undefined;
          if ((state.assignmentRef === undefined) !== (previous === undefined) || (state.assignmentRef !== undefined && previous !== undefined &&
            (previous.projectId !== ctx.scope.projectId || previous.srId !== ctx.scope.srId || previous.entityId !== state.assignmentRef.entityId || previous.version !== state.assignmentRef.version))) {
            return reject('STALE_VERSION', '현재 검토자 배정 버전이 바뀌었습니다.', gateBasis(ctx.scope, input.gate, state.revision));
          }
          const policyRef = state.policyRef;
          const policy = policyRef === undefined ? undefined : readPolicy(db, policyRef);
          if (policy === undefined) return reject('VALIDATION_ERROR', 'SR gate에 적용된 검토 정책이 없습니다.');
          const memberships = readReviewMemberships(db, ctx.scope.projectId);
          const assessment = assessReviewerAssignment(input.reviewerIds, sr.ownerId, memberships, policy.gates[input.gate]);
          if (assessment.reason?.includes('중복') || assessment.reason?.includes('멤버가 아닌')) return reject('VALIDATION_ERROR', assessment.reason);
          const now = new Date().toISOString();
          const value = appendAssignment(db, { scope: ctx.scope, gate: input.gate, actorId: ctx.actor.actorId, reviewerIds: input.reviewerIds,
            ...(previous === undefined ? {} : { previous }),
            ...('changeReason' in input ? { changeReason: input.changeReason } : {}), assignedAt: now, ready: assessment.ready, ...(assessment.reason === undefined ? {} : { notReadyReason: assessment.reason }) });
          updateGateConfiguration(db, ctx.scope, input.gate, { assignmentRef: value.assignmentRef });
          const impact = applyReviewConfigurationImpact(db, { projectId: ctx.scope.projectId, srId: ctx.scope.srId, actorId: ctx.actor.actorId, currentStage: sr.progressStage,
            changedVersionRef: value.assignmentRef, affectedGates: affectedReviewGates([input.gate]), reason: '검토자 배정이 바뀌어 승인 기준을 다시 검토합니다.', occurredAt: now });
          if (value.ready && options.documentReviewMode !== true) {
            captureCurrentReviewBundle(db, { scope: ctx.scope, gate: input.gate, actorId: ctx.actor.actorId, assignment: value, policy, createdAt: now });
          }
          const current = readGateState(db, ctx.scope, input.gate);
          if (current === undefined) throw new Error('변경한 gate를 읽을 수 없습니다.');
          const saved = receipt(ctx, 'M-030', hash, current.revision, [value.assignmentRef], now);
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertActivity(db, { projectId: ctx.scope.projectId, srId: ctx.scope.srId, actorId: ctx.actor.actorId, receiptId: saved.receiptId, eventType: 'reviewers_assigned', occurredAt: now, description: '검토자를 배정했습니다.', refs: [value.assignmentRef, ...impact.reviewImpact.affectedGates.map((gate) => ({ kind: 'review_gate_state', projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: gate }))] });
          return { kind: 'Committed', value, receipt: saved };
        });
      } catch { return reject('STORE_UNAVAILABLE', '검토자 배정을 확정하지 못했습니다.'); }
    },

    applyPolicyToSr(ctx, input) {
      const hash = fingerprint('M-031', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (!actorIsAdmin(db, ctx)) return reject('FORBIDDEN', '현재 팀 관리자만 SR 정책을 변경할 수 있습니다.');
          const prior = readCommandReceipt<PolicyApplicationResult>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            if (prior.receipt.commandKind !== 'M-031' || prior.receipt.inputFingerprint !== hash) return { kind: 'Rejected', error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: prior.receipt };
            const currentState = readGateState(db, ctx.scope, input.gates[0]);
            if (currentState === undefined) return reject('STORE_UNAVAILABLE', '정책 적용 receipt를 안전하게 재생할 수 없습니다.');
            const value = replayPolicyApplication(db, ctx.scope, input, prior.replayValue, prior.receipt.resultRefs);
            return { kind: 'Replayed', value, receipt: prior.receipt, current: gateBasis(ctx.scope, input.gates[0], currentState.revision) };
          }
          if (new Set(input.gates).size !== input.gates.length || input.gates.length === 0) return reject('VALIDATION_ERROR', '적용 gate가 비었거나 중복됐습니다.');
          if (input.policyRef.projectId !== ctx.scope.projectId) return reject('VALIDATION_ERROR', '정책과 SR의 프로젝트가 다릅니다.');
          const policy = readPolicy(db, input.policyRef);
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (policy === undefined || sr === undefined) return reject('NOT_FOUND', '정책 또는 SR을 찾을 수 없습니다.');
          const states = new Map(input.gates.map((gate) => [gate, readGateState(db, ctx.scope, gate)] as const));
          if ([...states.values()].some((state) => state === undefined)) return reject('NOT_FOUND', '검토 gate를 찾을 수 없습니다.');
          if (!validateApplicationGuard(ctx, input.gates, new Map([...states].map(([gate, state]) => [gate, state!.revision])))) return reject('STALE_VERSION', '선택 gate의 현재성 guard가 올바르지 않습니다.');
          const now = new Date().toISOString();
          input.gates.forEach((gate) => updateGateConfiguration(db, ctx.scope, gate, { policyRef: input.policyRef }));
          const affected = affectedReviewGates(input.gates);
          const impact = applyReviewConfigurationImpact(db, { projectId: ctx.scope.projectId, srId: ctx.scope.srId, actorId: ctx.actor.actorId,
            currentStage: sr.progressStage, changedVersionRef: input.policyRef, affectedGates: affected,
            reason: 'SR 검토 정책이 바뀌어 승인 기준을 다시 검토합니다.', occurredAt: now });
          const ordered = [...input.gates].sort();
          const gateResults = ordered.map((gate): { gate: 'G1' | 'G2'; result: ReviewBundleView } => {
            const state = readGateState(db, ctx.scope, gate);
            if (state?.assignmentRef === undefined) return { gate, result: { kind: 'NeedsInputs', gate, missing: ['검토자 배정이 필요합니다.'], assigneeIds: [sr.ownerId] } };
            const raw = readAssignment(db, state.assignmentRef);
            if (raw === undefined) throw new Error('현재 검토자 배정을 읽을 수 없습니다.');
            const assignment = assessedAssignment(db, ctx.scope, raw, policy);
            return { gate, result: captureCurrentReviewBundle(db, { scope: ctx.scope, gate, actorId: ctx.actor.actorId, assignment, policy, createdAt: now }) };
          });
          const first = gateResults[0];
          if (first === undefined) return reject('VALIDATION_ERROR', '적용 gate가 비었습니다.');
          const value: PolicyApplicationResult = { policyRef: input.policyRef, gates: [first, ...gateResults.slice(1)], reviewImpact: impact.reviewImpact };
          const committedRevision = Math.max(...input.gates.map((gate) => readGateState(db, ctx.scope, gate)?.revision ?? 0));
          const saved = receipt(ctx, 'M-031', hash, committedRevision, [input.policyRef, ...gateResults.flatMap((item) => item.result.kind === 'BundleAvailable' ? [item.result.bundle.bundleRef] : [])], now);
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertActivity(db, { projectId: ctx.scope.projectId, srId: ctx.scope.srId, actorId: ctx.actor.actorId, receiptId: saved.receiptId, eventType: 'review_policy_applied', occurredAt: now, description: 'SR에 검토 정책을 적용했습니다.', refs: [input.policyRef] });
          return { kind: 'Committed', value, receipt: saved };
        });
      } catch { return reject('STORE_UNAVAILABLE', 'SR 정책 적용을 확정하지 못했습니다.'); }
    },
  };
}
