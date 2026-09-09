import { createHash, randomUUID } from 'node:crypto';
import type {
  BundleGuard, CommandContext, NoGuard, QueryContext, RevisionAndBundleGuard, RevisionGuard, SrScope,
} from '@/src/contracts/context';
import type { CommandResult, CurrentBasis, DomainError, GateAssessment, ReviewImpact } from '@/src/contracts/results';
import type {
  ApprovalInput, ApprovalView, ReviewRequestInput, ReviewBundleSnapshot, ReviewBundleView,
  ChangeApplication, ChangeConfirmation, ChangeFeedback, ChangeRequestInput, ChangeRequestView,
  CommentInput, CommentView, SRView, StageTransition,
} from '@/src/contracts/views';
import type { Persistence } from '@/src/persistence/transaction';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readCommandReceipt, storeCommandReceipt } from '@/src/persistence/command-receipts';
import { readMembership, readReviewBundles, readSrOwner, readSrView } from '@/src/persistence/sr-repository';
import { readAssignment, readGateState, readPolicy } from '@/src/persistence/review-policy-repository';
import {
  appendApproval, appendGatePass, readApprovals, readBundleRequestIds,
} from '@/src/persistence/review-repository';
import { readQuestionViews, readDecisionViews } from '@/src/persistence/question-decision-repository';
import { assessReviewerAssignment } from '@/src/domain/review-policy';
import { assessGate as calculateGate } from '@/src/domain/gate-assessment';
import { readArtifactVersion } from '@/src/persistence/artifact-repository';
import { WorkspaceServiceError } from './workspace-service';
import {
  persistPreparedReviewBundle,
  prepareCurrentReviewBundle,
} from './review-bundle-snapshot';
import { canApplyChange, canReviewChange } from '@/src/domain/change-resolution';
import {
  appendChangeApplication, appendChangeRequest, appendChangeResolution, appendComment, appendFurtherChange,
  evidenceInputExists, readChangeRequest, strictChangeRequestReplay, strictCommentReplay,
} from '@/src/persistence/change-request-repository';
import { applyChangeRequestReviewImpact } from '@/src/persistence/review-impact-repository';

type ReviewRequestCommand = CommandContext<SrScope, RevisionGuard<'review_gate_state'>>;
type ApprovalCommand = CommandContext<SrScope, BundleGuard>;
type TransitionCommand = CommandContext<SrScope, RevisionAndBundleGuard<'sr'>>;
type CommentCommand = CommandContext<SrScope, NoGuard>;
type ChangeRequestCommand = CommandContext<SrScope, RevisionAndBundleGuard<'review_gate_state'>>;
type ChangeCommand = CommandContext<SrScope, RevisionGuard<'change_request'>>;
type ReviewCommand = ReviewRequestCommand | ApprovalCommand | TransitionCommand | CommentCommand | ChangeRequestCommand | ChangeCommand;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('JSON 값이 아닙니다.');
  return result;
}

function fingerprint(method: string, ctx: ReviewCommand, input: unknown): string {
  return `sha256:${createHash('sha256').update(canonical({ schemaVersion: 1, method, scope: ctx.scope, guard: ctx.guard, input })).digest('hex')}`;
}

function error(code: DomainError['code'], message: string, current?: CurrentBasis): DomainError {
  return { code, message, ...(current === undefined ? {} : { current }), blockers: [], assigneeIds: [], targetRefs: [] };
}

function rejected<T>(code: DomainError['code'], message: string, current?: CurrentBasis): CommandResult<T> {
  return { kind: 'Rejected', error: error(code, message, current) };
}

function gateBasis(scope: SrScope, gate: 'G1' | 'G2', revision: number): CurrentBasis {
  return {
    target: { kind: 'review_gate_state', projectId: scope.projectId, srId: scope.srId, entityId: gate },
    currentRevision: revision,
    allowedActions: [],
  };
}

function changeBasis(scope: SrScope, changeRequestId: string, revision: number): CurrentBasis {
  return {
    target: { kind: 'change_request', projectId: scope.projectId, srId: scope.srId, entityId: changeRequestId },
    currentRevision: revision,
    allowedActions: [],
  };
}

function exactChangeGuard(ctx: ChangeCommand, change: ChangeRequestView): boolean {
  const target = ctx.guard.resource.target;
  return target.kind === 'change_request' && target.projectId === ctx.scope.projectId &&
    target.srId === ctx.scope.srId && target.entityId === change.changeRequestId &&
    ctx.guard.resource.expectedRevision === change.revision;
}

function artifactIsCurrent(db: DatabaseConnection, scope: SrScope, ref: import('@/src/contracts/context').ArtifactVersionRef): boolean {
  return db.prepare(`SELECT 1 FROM artifacts WHERE project_id=? AND sr_id=? AND artifact_id=? AND current_version=?`)
    .get(scope.projectId, scope.srId, ref.entityId, ref.version) !== undefined;
}

function artifactSectionExists(db: DatabaseConnection, scope: SrScope,
  ref: import('@/src/contracts/context').ArtifactVersionRef, sectionId: string): boolean {
  return ref.projectId === scope.projectId && ref.srId === scope.srId && db.prepare(`SELECT 1 FROM artifact_versions v
    JOIN json_each(v.section_index_json) section ON json_extract(section.value,'$.sectionId')=?
    WHERE v.project_id=? AND v.sr_id=? AND v.artifact_id=? AND v.version=?`)
    .get(sectionId, scope.projectId, scope.srId, ref.entityId, ref.version) !== undefined;
}

function strictEntityReceipt(
  receipt: import('@/src/contracts/results').CommandReceipt,
  scope: SrScope,
  kind: 'comment' | 'change_request',
  entityId: string,
): import('@/src/contracts/results').CommandReceipt {
  const ref = receipt.resultRefs.length === 1 ? receipt.resultRefs[0] : undefined;
  if (ref === undefined || !('kind' in ref) || ref.kind !== kind || ref.projectId !== scope.projectId ||
    ref.srId !== scope.srId || ref.entityId !== entityId || receipt.scope.kind !== 'sr' ||
    receipt.scope.projectId !== scope.projectId || receipt.scope.srId !== scope.srId) {
    throw new Error('명령 receipt 결과 ref가 올바르지 않습니다.');
  }
  return { ...receipt, scope, resultRefs: [{ kind, projectId: scope.projectId, srId: scope.srId, entityId }] };
}

function sameRef(left: object, right: object): boolean {
  return canonical(left) === canonical(right);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value));
}

function sameCanonicalSet(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(canonical).sort();
  const rightKeys = right.map(canonical).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function requestMatchesSnapshot(input: ReviewRequestInput, snapshot: Omit<ReviewBundleSnapshot, 'bundleRef'>): boolean {
  const baseMatches = sameCanonicalSet(input.artifactVersionRefs, snapshot.artifactVersionRefs) &&
    sameCanonicalSet(input.decisionVersionRefs, snapshot.decisionVersionRefs) &&
    sameCanonicalSet(input.unconfirmedDecisionSnapshots, snapshot.unconfirmedDecisionSnapshots) &&
    sameCanonicalSet(input.questionResultRefs, snapshot.questionResultRefs) &&
    sameCanonicalSet(input.classificationRefs, snapshot.classificationRefs) &&
    sameCanonicalSet(input.contextSourceVersionRefs, snapshot.contextSourceVersionRefs) &&
    sameRef(input.assignmentRef, snapshot.assignmentRef) && sameStringSet(input.reviewerIds, snapshot.reviewerIds) &&
    sameRef(input.policyRef, snapshot.policyRef);
  return baseMatches && (input.gate === 'G1' || sameRef(input.g1BundleRef, snapshot.g1BundleRef ?? {}));
}

function snapshotMatchesCurrent(left: ReviewBundleSnapshot, right: Omit<ReviewBundleSnapshot, 'bundleRef'>): boolean {
  const base = {
    artifactVersionRefs: left.artifactVersionRefs,
    decisionVersionRefs: left.decisionVersionRefs,
    unconfirmedDecisionSnapshots: left.unconfirmedDecisionSnapshots,
    questionResultRefs: left.questionResultRefs,
    classificationRefs: left.classificationRefs,
    contextSourceVersionRefs: left.contextSourceVersionRefs,
    assignmentRef: left.assignmentRef,
    reviewerIds: left.reviewerIds,
    policyRef: left.policyRef,
  };
  const request: ReviewRequestInput = left.bundleRef.gate === 'G1'
    ? { gate: 'G1', ...base }
    : { gate: 'G2', ...base, g1BundleRef: left.g1BundleRef! };
  return requestMatchesSnapshot(request, right) && left.reviewEpoch === right.reviewEpoch && sameRef(left.descriptionRef, right.descriptionRef);
}

function insertActivity(db: DatabaseConnection, ctx: ReviewRequestCommand, receiptId: string, occurredAt: string, refs: readonly object[]): void {
  db.prepare(`INSERT INTO activity_events(project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,occurred_at,receipt_id,internal_basis_json,description,payload_json)
    VALUES (?,?,?,'review_requested','user',?,?,?, ?,NULL,'공식 검토를 요청했습니다.','{}')`).run(
    ctx.scope.projectId, `activity-${randomUUID()}`, ctx.scope.srId, ctx.actor.actorId,
    JSON.stringify(refs), occurredAt, receiptId,
  );
}

function insertWorkflowActivity(db: DatabaseConnection, input: {
  readonly ctx: ReviewCommand;
  readonly receiptId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly description: string;
  readonly refs: readonly object[];
}): void {
  db.prepare(`INSERT INTO activity_events(project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,occurred_at,receipt_id,internal_basis_json,description,payload_json)
    VALUES (?,?,?,?,'user',?,?,?, ?,NULL,?,'{}')`).run(
    input.ctx.scope.projectId, `activity-${randomUUID()}`, input.ctx.scope.srId, input.eventType,
    input.ctx.actor.actorId, JSON.stringify(input.refs), input.occurredAt, input.receiptId, input.description,
  );
}

function sameBundle(left: import('@/src/contracts/context').BundleRef, right: import('@/src/contracts/context').BundleRef): boolean {
  return left.projectId === right.projectId && left.srId === right.srId && left.gate === right.gate &&
    left.bundleId === right.bundleId && left.version === right.version;
}

function currentBundle(db: DatabaseConnection, scope: SrScope, gate: 'G1' | 'G2'): ReviewBundleSnapshot | undefined {
  const state = readGateState(db, scope, gate);
  if (state?.currentBundleRef === undefined) return undefined;
  return readReviewBundles(db, scope.projectId, scope.srId).find((bundle) => sameBundle(bundle.bundleRef, state.currentBundleRef!));
}

export interface ReviewAssessmentOptions {
  readonly documentReviewMode?: boolean;
}

export function buildAssessment(
  db: DatabaseConnection,
  scope: SrScope,
  gate: 'G1' | 'G2',
  options: ReviewAssessmentOptions = {},
): GateAssessment {
  const sr = readSrView(db, scope.projectId, scope.srId);
  const state = readGateState(db, scope, gate);
  if (sr === undefined || state === undefined) throw new WorkspaceServiceError(error('NOT_FOUND', 'SR 또는 검토 gate를 찾을 수 없습니다.'));
  const bundle = currentBundle(db, scope, gate);
  const assignment = state.assignmentRef === undefined ? undefined : readAssignment(db, state.assignmentRef);
  const policy = state.policyRef === undefined ? undefined : readPolicy(db, state.policyRef);
  const gateSet = gate === 'G1' ? new Set(['G1']) : new Set(['G1', 'G2']);
  const decisions = readDecisionViews(db, scope.projectId, scope.srId);
  const questions = readQuestionViews(db, scope.projectId, scope.srId)
    .filter((question) => question.currentClassification.scope === 'current' && gateSet.has(question.currentClassification.requiredGate))
    .map((question) => ({
      questionId: question.questionId,
      requiredGate: question.currentClassification.requiredGate as 'G1' | 'G2',
      assigneeId: question.assigneeId,
      status: question.status,
      convertedDecisionLinked: question.status !== 'converted_to_decision' ||
        (question.convertedDecisionId !== undefined && decisions.some((decision) =>
          decision.decisionId === question.convertedDecisionId && decision.originQuestionId === question.questionId &&
          decision.scope.projectId === scope.projectId && decision.scope.srId === scope.srId)),
    }));
  const relevantDecisions = decisions
    .filter((decision) => decision.currentClassification.scope === 'current' && gateSet.has(decision.currentClassification.requiredGate))
    .map((decision) => ({ decisionId: decision.decisionId, requiredGate: decision.currentClassification.requiredGate as 'G1' | 'G2',
      decisionMakerId: decision.decisionMakerId,
      confirmed: decision.currentConfirmation !== undefined }));
  const approvals = bundle === undefined ? [] : readApprovals(db, scope.projectId, scope.srId)
    .filter((approval) => sameBundle(approval.bundleRef, bundle.bundleRef) && approval.reviewEpoch === bundle.reviewEpoch)
    .map((approval) => ({ approvalId: approval.approvalId, approverId: approval.approverId,
      checklistItemIds: approval.checklistResults.map((item) => item.itemId) }));
  const reviewerRoles = Object.fromEntries((assignment?.reviewerIds ?? []).map((reviewerId) => [
    reviewerId, readMembership(db, scope.projectId, reviewerId)?.roles ?? [],
  ]));
  const blockingChanges = (db.prepare(`SELECT change_request_id,assignee_id FROM change_requests
    WHERE project_id=? AND sr_id=? AND blocking=1 AND status<>'resolved' AND affected_gate IN (${gate === 'G1' ? "'G1'" : "'G1','G2'"})
    ORDER BY change_request_id`).all(scope.projectId, scope.srId) as Array<{ change_request_id: string; assignee_id: string }>)
    .map((row) => ({ changeRequestId: row.change_request_id, assigneeId: row.assignee_id }));
  const artifacts = bundle === undefined ? [] : bundle.artifactVersionRefs.map((ref) => {
    const artifact = readArtifactVersion(db, ref);
    if (artifact === undefined) throw new Error('bundle 문서 version을 찾을 수 없습니다.');
    return artifact;
  });
  const artifactKinds = artifacts.map((artifact) => artifact.kind);
  const requirementsNonempty = artifacts.some((artifact) =>
    artifact.kind === 'requirements' && artifact.markdown.trim().length > 0);
  const requirementsStructured = artifacts.some((artifact) => artifact.kind === 'requirements' &&
    artifact.sectionIndex.length > 0 && artifact.requirementLinks.length > 0 &&
    artifact.requirementLinks.every((link) => link.sectionIds.length > 0 && link.acceptanceCriteria.length > 0 &&
      link.acceptanceCriteria.every((criterion) => criterion.trim().length > 0)));
  let basisCurrent = false;
  if (bundle !== undefined && assignment !== undefined && policy !== undefined) {
    const prepared = prepareCurrentReviewBundle(db, {
      scope, gate, actorId: sr.ownerId, assignment, policy, createdAt: bundle.createdAt,
    });
    basisCurrent = prepared.kind === 'Prepared' && snapshotMatchesCurrent(bundle, prepared.snapshot);
  }
  const g1 = readGateState(db, scope, 'G1');
  return calculateGate({
    projectId: scope.projectId,
    srId: scope.srId,
    ownerId: sr.ownerId,
    assessedRevision: sr.revision,
    gate,
    ...(options.documentReviewMode === undefined ? {} : { documentReviewMode: options.documentReviewMode }),
    reviewEpoch: state.reviewEpoch,
    needsNewBundle: state.needsNewBundle,
    ...(state.currentBundleRef === undefined ? {} : { currentBundleRef: state.currentBundleRef }),
    ...(bundle === undefined ? {} : { bundle: {
      ref: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, assignmentRef: bundle.assignmentRef,
      policyRef: bundle.policyRef, artifactKinds, requirementsNonempty, requirementsStructured, basisCurrent,
      ...(bundle.g1BundleRef === undefined ? {} : { g1BundleRef: bundle.g1BundleRef }),
    } }),
    ...(assignment === undefined ? {} : { assignment: { ref: assignment.assignmentRef, reviewerIds: assignment.reviewerIds } }),
    ...(policy === undefined ? {} : { policy: {
      ref: policy.policyRef, requiredRoles: policy.gates[gate].requiredRoles,
      checklistItemIds: policy.gates[gate].checklist.map((item) => item.itemId),
    } }),
    reviewerRoles,
    approvals,
    questions,
    decisions: relevantDecisions,
    blockingChanges,
    ...(gate === 'G1' || g1 === undefined ? {} : { g1: {
      valid: g1.validity === 'valid' && !g1.needsNewBundle,
      ...(g1.currentBundleRef?.gate === 'G1' ? { currentBundleRef: g1.currentBundleRef as import('@/src/contracts/context').BundleRef<'G1'> } : {}),
    } }),
  });
}

function approvalFromStored(db: DatabaseConnection, scope: SrScope, approvalId: string): ApprovalView | undefined {
  return readApprovals(db, scope.projectId, scope.srId).find((approval) => approval.approvalId === approvalId);
}

function strictSrReplay(raw: unknown, scope: SrScope): SRView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('SR replay value가 객체가 아닙니다.');
  const row = raw as Record<string, unknown>;
  const rawScope = row.scope;
  if (typeof rawScope !== 'object' || rawScope === null || Array.isArray(rawScope) ||
    (rawScope as Record<string, unknown>).kind !== 'sr' || (rawScope as Record<string, unknown>).projectId !== scope.projectId ||
    (rawScope as Record<string, unknown>).srId !== scope.srId || typeof row.key !== 'string' || row.key.trim().length === 0 ||
    typeof row.title !== 'string' || row.title.trim().length === 0 || typeof row.ownerId !== 'string' || row.ownerId.trim().length === 0 ||
    typeof row.progressStage !== 'string' || !Number.isInteger(row.revision) || (row.revision as number) < 0 || !Array.isArray(row.gates)) {
    throw new Error('SR replay value가 올바르지 않습니다.');
  }
  const ref = (value: unknown, kind: 'sr_description') => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('SR replay description ref가 올바르지 않습니다.');
    const item = value as Record<string, unknown>;
    if (item.kind !== kind || item.projectId !== scope.projectId || item.srId !== scope.srId ||
      typeof item.entityId !== 'string' || item.entityId.trim().length === 0 || !Number.isInteger(item.version) || (item.version as number) < 1) {
      throw new Error('SR replay description ref가 올바르지 않습니다.');
    }
    return { kind, projectId: scope.projectId, srId: scope.srId, entityId: item.entityId, version: item.version as number };
  };
  const stages = new Set(['sr_received', 'requirements', 'planning', 'ready', 'implementing', 'completed']);
  if (!stages.has(row.progressStage)) throw new Error('SR replay 단계가 올바르지 않습니다.');
  const decodeBundleRef = (value: unknown): import('@/src/contracts/context').BundleRef | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('SR replay bundle ref가 올바르지 않습니다.');
    const item = value as Record<string, unknown>;
    if ((item.gate !== 'G1' && item.gate !== 'G2') || item.projectId !== scope.projectId || item.srId !== scope.srId ||
      typeof item.bundleId !== 'string' || item.bundleId.trim().length === 0 || !Number.isInteger(item.version) || (item.version as number) < 1) {
      throw new Error('SR replay bundle ref가 올바르지 않습니다.');
    }
    return { projectId: scope.projectId, srId: scope.srId, gate: item.gate,
      bundleId: item.bundleId, version: item.version as number };
  };
  const gates = row.gates.map((value): SRView['gates'][number] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('SR replay gate가 올바르지 않습니다.');
    const item = value as Record<string, unknown>;
    if ((item.gate !== 'G1' && item.gate !== 'G2') || (item.validity !== 'not_passed' && item.validity !== 'valid' && item.validity !== 'invalid') ||
      !Number.isInteger(item.reviewEpoch) || (item.reviewEpoch as number) < 1 || !Array.isArray(item.blockers) ||
      item.blockers.some((x) => typeof x !== 'string')) throw new Error('SR replay gate가 올바르지 않습니다.');
    const currentBundleRef = decodeBundleRef(item.currentBundleRef);
    if (currentBundleRef !== undefined && currentBundleRef.gate !== item.gate) throw new Error('SR replay gate bundle이 다릅니다.');
    return { gate: item.gate, validity: item.validity, reviewEpoch: item.reviewEpoch as number,
      ...(currentBundleRef === undefined ? {} : { currentBundleRef }), blockers: item.blockers as string[] };
  });
  if (gates.length !== 2 || new Set(gates.map((gate) => gate.gate)).size !== 2) throw new Error('SR replay gate 집합이 올바르지 않습니다.');
  let reviewImpact: ReviewImpact | undefined;
  if (row.reviewImpact !== undefined) {
    if (typeof row.reviewImpact !== 'object' || row.reviewImpact === null || Array.isArray(row.reviewImpact)) throw new Error('SR replay 영향이 올바르지 않습니다.');
    const impact = row.reviewImpact as Record<string, unknown>;
    if (!Array.isArray(impact.affectedGates) || impact.affectedGates.some((gate) => gate !== 'G1' && gate !== 'G2') ||
      !Array.isArray(impact.carriedBlockingRequestIds) || impact.carriedBlockingRequestIds.some((id) => typeof id !== 'string') ||
      typeof impact.needsNewReview !== 'boolean' || typeof impact.currentHandoffValid !== 'boolean' ||
      (impact.returnStage !== undefined && (typeof impact.returnStage !== 'string' || !stages.has(impact.returnStage)))) {
      throw new Error('SR replay 영향이 올바르지 않습니다.');
    }
    reviewImpact = {
      affectedGates: impact.affectedGates as Array<'G1' | 'G2'>,
      needsNewReview: impact.needsNewReview,
      ...(impact.returnStage === undefined ? {} : { returnStage: impact.returnStage as string }),
      carriedBlockingRequestIds: impact.carriedBlockingRequestIds as string[],
      currentHandoffValid: impact.currentHandoffValid,
    };
  }
  return {
    scope,
    key: row.key,
    title: row.title,
    ownerId: row.ownerId,
    originalDescriptionRef: ref(row.originalDescriptionRef, 'sr_description'),
    currentDescriptionRef: ref(row.currentDescriptionRef, 'sr_description'),
    progressStage: row.progressStage as SRView['progressStage'],
    revision: row.revision as number,
    gates,
    ...(reviewImpact === undefined ? {} : { reviewImpact }),
  };
}

export interface ReviewWorkflowService {
  requestReview(ctx: ReviewRequestCommand, input: ReviewRequestInput): CommandResult<ReviewBundleView>;
  recordApproval(ctx: ApprovalCommand, input: ApprovalInput): CommandResult<ApprovalView>;
  addComment(ctx: CommentCommand, input: CommentInput): CommandResult<CommentView>;
  requestChange(ctx: ChangeRequestCommand, input: ChangeRequestInput): CommandResult<ChangeRequestView>;
  submitChangeResult(ctx: ChangeCommand, input: ChangeApplication): CommandResult<ChangeRequestView>;
  confirmChangeResolution(ctx: ChangeCommand, input: ChangeConfirmation): CommandResult<ChangeRequestView>;
  requestFurtherChange(ctx: ChangeCommand, input: ChangeFeedback): CommandResult<ChangeRequestView>;
  assessGate(ctx: QueryContext<SrScope>, gate: 'G1' | 'G2'): GateAssessment;
  transitionStage(ctx: TransitionCommand, input: StageTransition): CommandResult<SRView>;
}

export function createReviewWorkflowService(
  persistence: Persistence,
  options: ReviewAssessmentOptions = {},
): ReviewWorkflowService {
  return {
    requestReview(ctx, input) {
      const hash = fingerprint('M-020', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const membership = readMembership(db, ctx.scope.projectId, ctx.actor.actorId);
          if (ctx.actor.projectId !== ctx.scope.projectId || membership === undefined) return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected('NOT_FOUND', 'SR을 찾을 수 없습니다.');
          if (ownerId !== ctx.actor.actorId) return rejected('NOT_ASSIGNED', '현재 SR 담당자만 검토를 요청할 수 있습니다.');
          const prior = readCommandReceipt<ReviewBundleView>(db, {
            scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey,
          });
          if (prior !== undefined) {
            if (prior.receipt.commandKind !== 'M-020' || prior.receipt.inputFingerprint !== hash) {
              return { kind: 'Rejected', error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: prior.receipt };
            }
            const ref = prior.receipt.resultRefs.find((item): item is import('@/src/contracts/context').BundleRef =>
              !('kind' in item) && item.projectId === ctx.scope.projectId && item.srId === ctx.scope.srId && item.gate === input.gate);
            const bundle = ref === undefined ? undefined : readReviewBundles(db, ctx.scope.projectId, ctx.scope.srId)
              .find((item) => item.bundleRef.bundleId === ref.bundleId && item.bundleRef.version === ref.version && item.bundleRef.gate === ref.gate);
            const state = readGateState(db, ctx.scope, input.gate);
            if (bundle === undefined || state === undefined) return rejected('STORE_UNAVAILABLE', '검토 요청 receipt를 재생할 수 없습니다.');
            return {
              kind: 'Replayed',
              value: { kind: 'BundleAvailable', bundle, requestIds: readBundleRequestIds(db, bundle.bundleRef, bundle.reviewerIds) },
              receipt: prior.receipt,
              current: gateBasis(ctx.scope, input.gate, state.revision),
            };
          }
          const state = readGateState(db, ctx.scope, input.gate);
          if (state === undefined) return rejected('NOT_FOUND', '검토 gate를 찾을 수 없습니다.');
          const expected = ctx.guard.resource;
          if (expected.target.kind !== 'review_gate_state' || expected.target.projectId !== ctx.scope.projectId ||
            expected.target.srId !== ctx.scope.srId || expected.target.entityId !== input.gate) {
            return rejected('VALIDATION_ERROR', 'guard 대상이 검토 gate와 다릅니다.', gateBasis(ctx.scope, input.gate, state.revision));
          }
          if (expected.expectedRevision !== state.revision) return rejected('STALE_VERSION', '검토 gate revision이 바뀌었습니다.', gateBasis(ctx.scope, input.gate, state.revision));
          if (state.assignmentRef === undefined || state.policyRef === undefined) return rejected('GATE_BLOCKED', '검토 정책과 배정이 필요합니다.');
          const storedAssignment = readAssignment(db, state.assignmentRef);
          const policy = readPolicy(db, state.policyRef);
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (storedAssignment === undefined || policy === undefined || sr === undefined) throw new Error('현재 검토 정책 또는 배정을 읽을 수 없습니다.');
          const members = storedAssignment.reviewerIds.map((id) => readMembership(db, ctx.scope.projectId, id)).filter((item): item is NonNullable<typeof item> => item !== undefined);
          const readiness = assessReviewerAssignment(storedAssignment.reviewerIds, sr.ownerId, members, policy.gates[input.gate]);
          const assignment = { ...storedAssignment, ready: readiness.ready, ...(readiness.reason === undefined ? {} : { notReadyReason: readiness.reason }) };
          const now = new Date().toISOString();
          const prepared = prepareCurrentReviewBundle(db, {
            scope: ctx.scope, gate: input.gate, actorId: ctx.actor.actorId, assignment, policy, createdAt: now,
          });
          if (prepared.kind === 'NeedsInputs') {
            return { kind: 'Rejected', error: {
              ...error('GATE_BLOCKED', '공식 검토 묶음을 만들 필수 입력이 부족합니다.'),
              blockers: prepared.missing.map((reason) => ({ code: 'REVIEW_INPUT_MISSING', reason,
                assigneeIds: prepared.assigneeIds, targetRefs: [] })), assigneeIds: prepared.assigneeIds,
            } };
          }
          if (!requestMatchesSnapshot(input, prepared.snapshot)) return rejected('STALE_VERSION', '요청한 검토 참조가 현재 자료와 다릅니다.', gateBasis(ctx.scope, input.gate, state.revision));
          const current = state.currentBundleRef === undefined ? undefined : readReviewBundles(db, ctx.scope.projectId, ctx.scope.srId)
            .find((item) => item.bundleRef.bundleId === state.currentBundleRef?.bundleId && item.bundleRef.version === state.currentBundleRef.version && item.bundleRef.gate === input.gate);
          const value: ReviewBundleView = current !== undefined && !state.needsNewBundle && snapshotMatchesCurrent(current, prepared.snapshot)
            ? { kind: 'BundleAvailable', bundle: current, requestIds: readBundleRequestIds(db, current.bundleRef, current.reviewerIds) }
            : persistPreparedReviewBundle(db, {
              scope: ctx.scope, gate: input.gate, actorId: ctx.actor.actorId, assignment, policy, createdAt: now,
            }, prepared, { advanceGateRevision: true });
          const bundle = value.bundle;
          const committedState = readGateState(db, ctx.scope, input.gate);
          if (committedState === undefined) throw new Error('변경한 검토 gate를 읽을 수 없습니다.');
          const saved = {
            scope: ctx.scope, receiptId: `receipt-${randomUUID()}`,
            actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId }, commandKind: 'M-020',
            requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash,
            committedRevision: committedState.revision, resultRefs: [bundle.bundleRef], committedAt: now,
          };
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertActivity(db, ctx, saved.receiptId, now, [bundle.bundleRef]);
          return { kind: 'Committed', value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '공식 검토 요청을 확정하지 못했습니다.');
      }
    },
    recordApproval(ctx, input) {
      const hash = fingerprint('M-021', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const membership = readMembership(db, ctx.scope.projectId, ctx.actor.actorId);
          if (ctx.actor.projectId !== ctx.scope.projectId || membership === undefined) return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          const state = readGateState(db, ctx.scope, input.approvalScope);
          if (state === undefined) return rejected('NOT_FOUND', '검토 gate를 찾을 수 없습니다.');
          const currentAssignment = state.assignmentRef === undefined ? undefined : readAssignment(db, state.assignmentRef);
          if (currentAssignment === undefined || !currentAssignment.reviewerIds.includes(ctx.actor.actorId)) {
            return rejected('NOT_ASSIGNED', '현재 gate의 지정 검토자가 아닙니다.');
          }
          const prior = readCommandReceipt<ApprovalView>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            if (prior.receipt.commandKind !== 'M-021' || prior.receipt.inputFingerprint !== hash) return { kind: 'Rejected', error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: prior.receipt };
            const ref = prior.receipt.resultRefs.find((item): item is import('@/src/contracts/context').EntityRef<'approval'> => 'kind' in item && item.kind === 'approval');
            const value = ref === undefined ? undefined : approvalFromStored(db, ctx.scope, ref.entityId);
            if (value === undefined) return rejected('STORE_UNAVAILABLE', 'approval receipt를 재생할 수 없습니다.');
            return { kind: 'Replayed', value, receipt: prior.receipt, current: gateBasis(ctx.scope, input.approvalScope, state.revision) };
          }
          const bundle = currentBundle(db, ctx.scope, input.approvalScope);
          if (bundle === undefined) return rejected('STALE_BUNDLE', '현재 공식 검토 묶음이 없습니다.');
          if (!sameBundle(input.bundleRef, ctx.guard.expectedBundleRef) || input.reviewEpoch !== ctx.guard.expectedReviewEpoch ||
            !sameBundle(bundle.bundleRef, input.bundleRef) || state.reviewEpoch !== input.reviewEpoch || state.needsNewBundle) {
            return rejected('STALE_BUNDLE', '현재 공식 묶음 또는 review epoch가 바뀌었습니다.', gateBasis(ctx.scope, input.approvalScope, state.revision));
          }
          if (!bundle.reviewerIds.includes(ctx.actor.actorId)) {
            return rejected('NOT_ASSIGNED', '현재 묶음의 지정 검토자가 아닙니다.');
          }
          if (input.bundleRef.gate !== input.approvalScope) return rejected('VALIDATION_ERROR', '승인 범위와 bundle gate가 다릅니다.');
          if (readApprovals(db, ctx.scope.projectId, ctx.scope.srId).some((approval) =>
            sameBundle(approval.bundleRef, bundle.bundleRef) && approval.reviewEpoch === bundle.reviewEpoch &&
            approval.approverId === ctx.actor.actorId)) {
            return rejected('VALIDATION_ERROR', '현재 묶음은 이미 승인했습니다.');
          }
          const required = bundle.checklistSnapshot.map((item) => item.itemId);
          const checked = input.checklistResults.map((item) => item.itemId);
          if (new Set(checked).size !== checked.length || checked.length !== required.length || !required.every((id) => checked.includes(id))) {
            return rejected('VALIDATION_ERROR', '현재 정책의 필수 체크리스트를 정확히 확인해야 합니다.');
          }
          const now = new Date().toISOString();
          const value = appendApproval(db, { scope: ctx.scope, bundle, approverId: ctx.actor.actorId,
            checklistResults: input.checklistResults, ...(input.comment === undefined ? {} : { comment: input.comment }), approvedAt: now });
          const approvalRef = { kind: 'approval' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.approvalId };
          const saved = { scope: ctx.scope, receiptId: `receipt-${randomUUID()}`, actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
            commandKind: 'M-021', requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash,
            committedRevision: state.revision, resultRefs: [approvalRef], committedAt: now };
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertWorkflowActivity(db, { ctx, receiptId: saved.receiptId, eventType: 'review_approved', occurredAt: now,
            description: '현재 공식 묶음을 개별 승인했습니다.', refs: [bundle.bundleRef, approvalRef] });
          return { kind: 'Committed', value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '개별 승인을 확정하지 못했습니다.');
      }
    },
    addComment(ctx, input) {
      const hash = fingerprint('M-022', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (ctx.actor.projectId !== ctx.scope.projectId || readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined) {
            return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          }
          const prior = readCommandReceipt<CommentView>(db, {
            scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey,
          });
          if (prior !== undefined) {
            const value = strictCommentReplay(prior.replayValue, ctx.scope);
            const receipt = strictEntityReceipt(prior.receipt, ctx.scope, 'comment', value.commentId);
            if (receipt.commandKind !== 'M-022' || receipt.inputFingerprint !== hash) {
              return { kind: 'Rejected' as const, error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: receipt };
            }
            return { kind: 'Replayed' as const, value, receipt,
              current: { target: input.artifactVersionRef, allowedActions: [] } };
          }
          if (input.body.trim().length === 0 || input.sectionId.trim().length === 0) {
            return rejected('VALIDATION_ERROR', '댓글 본문과 section이 필요합니다.');
          }
          if (!artifactSectionExists(db, ctx.scope, input.artifactVersionRef, input.sectionId)) {
            return rejected('VALIDATION_ERROR', '댓글 대상 문서 section이 현재 SR에 없습니다.');
          }
          if (input.bundleRef !== undefined && db.prepare(`SELECT 1 FROM review_bundles
            WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`).get(ctx.scope.projectId,
            ctx.scope.srId, input.bundleRef.gate, input.bundleRef.bundleId, input.bundleRef.version) === undefined) {
            return rejected('VALIDATION_ERROR', '댓글 bundle을 찾을 수 없습니다.');
          }
          const now = new Date().toISOString();
          const value = appendComment(db, { scope: ctx.scope, actorId: ctx.actor.actorId, value: input, occurredAt: now });
          const resultRef = { kind: 'comment' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.commentId };
          const saved = { scope: ctx.scope, receiptId: `receipt-${randomUUID()}`, actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
            commandKind: 'M-022', requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash,
            committedRevision: 1, resultRefs: [resultRef], committedAt: now } as const;
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertWorkflowActivity(db, { ctx, receiptId: saved.receiptId, eventType: 'comment_added', occurredAt: now,
            description: '문서 section에 댓글을 추가했습니다.', refs: [resultRef, input.artifactVersionRef] });
          return { kind: 'Committed' as const, value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '댓글을 저장하지 못했습니다.');
      }
    },
    requestChange(ctx, input) {
      const hash = fingerprint('M-023', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (ctx.actor.projectId !== ctx.scope.projectId || readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined) {
            return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          }
          const state = readGateState(db, ctx.scope, input.affectedGate);
          if (state === undefined) return rejected('NOT_FOUND', '검토 gate를 찾을 수 없습니다.');
          const assignment = state.assignmentRef === undefined ? undefined : readAssignment(db, state.assignmentRef);
          if (assignment === undefined || !assignment.reviewerIds.includes(ctx.actor.actorId)) {
            return rejected('NOT_ASSIGNED', '현재 영향 gate의 지정 검토자만 수정을 요청할 수 있습니다.');
          }
          const prior = readCommandReceipt<ChangeRequestView>(db, {
            scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey,
          });
          if (prior !== undefined) {
            const value = strictChangeRequestReplay(prior.replayValue, ctx.scope);
            const receipt = strictEntityReceipt(prior.receipt, ctx.scope, 'change_request', value.changeRequestId);
            if (receipt.commandKind !== 'M-023' || receipt.inputFingerprint !== hash) {
              return { kind: 'Rejected' as const, error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: receipt };
            }
            return { kind: 'Replayed' as const, value, receipt,
              current: gateBasis(ctx.scope, input.affectedGate, state.revision) };
          }
          const target = ctx.guard.resource.target;
          if (target.kind !== 'review_gate_state' || target.projectId !== ctx.scope.projectId || target.srId !== ctx.scope.srId ||
            target.entityId !== input.affectedGate) return rejected('VALIDATION_ERROR', 'guard 대상이 영향 gate와 다릅니다.');
          if (ctx.guard.resource.expectedRevision !== state.revision) {
            return rejected('STALE_VERSION', '검토 gate revision이 바뀌었습니다.', gateBasis(ctx.scope, input.affectedGate, state.revision));
          }
          if (state.currentBundleRef === undefined || state.needsNewBundle ||
            !sameBundle(ctx.guard.expectedBundleRef, state.currentBundleRef) || ctx.guard.expectedReviewEpoch !== state.reviewEpoch ||
            (input.bundleRef !== undefined && !sameBundle(input.bundleRef, state.currentBundleRef))) {
            return rejected('STALE_BUNDLE', '현재 공식 묶음 또는 review epoch가 바뀌었습니다.', gateBasis(ctx.scope, input.affectedGate, state.revision));
          }
          if (readMembership(db, ctx.scope.projectId, input.assigneeId) === undefined) {
            return rejected('NOT_ASSIGNED', '수정 담당자가 현재 프로젝트 멤버가 아닙니다.');
          }
          if (input.body.trim().length === 0 || input.sectionId.trim().length === 0) {
            return rejected('VALIDATION_ERROR', '수정 요청 본문과 section이 필요합니다.');
          }
          if (!artifactSectionExists(db, ctx.scope, input.artifactVersionRef, input.sectionId)) {
            return rejected('VALIDATION_ERROR', '수정 요청 대상 문서 section이 현재 SR에 없습니다.');
          }
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return rejected('NOT_FOUND', 'SR을 찾을 수 없습니다.');
          const now = new Date().toISOString();
          const value = appendChangeRequest(db, { scope: ctx.scope, actorId: ctx.actor.actorId, value: input, occurredAt: now });
          applyChangeRequestReviewImpact(db, { projectId: ctx.scope.projectId, srId: ctx.scope.srId,
            actorId: ctx.actor.actorId, currentStage: sr.progressStage, changedTargetRef: input.artifactVersionRef,
            blocking: input.blocking, affectedGate: input.affectedGate, occurredAt: now });
          const resultRef = { kind: 'change_request' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.changeRequestId };
          const saved = { scope: ctx.scope, receiptId: `receipt-${randomUUID()}`, actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
            commandKind: 'M-023', requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash,
            committedRevision: value.revision, resultRefs: [resultRef], committedAt: now } as const;
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertWorkflowActivity(db, { ctx, receiptId: saved.receiptId, eventType: 'change_requested', occurredAt: now,
            description: '문서 section의 수정을 요청했습니다.', refs: [resultRef, input.artifactVersionRef] });
          return { kind: 'Committed' as const, value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '수정 요청을 저장하지 못했습니다.');
      }
    },
    submitChangeResult(ctx, input) {
      const hash = fingerprint('M-024', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (ctx.actor.projectId !== ctx.scope.projectId || readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined) return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          const current = readChangeRequest(db, ctx.scope, input.changeRequestId);
          if (current === undefined) return rejected('NOT_FOUND', '수정 요청을 찾을 수 없습니다.');
          if (!canApplyChange({ actorId: ctx.actor.actorId, assigneeId: current.assigneeId,
            srOwnerId: readSrOwner(db, ctx.scope.projectId, ctx.scope.srId) ?? '' })) return rejected('NOT_ASSIGNED', '현재 담당자 또는 SR 담당자만 반영 결과를 제출할 수 있습니다.');
          const prior = readCommandReceipt<ChangeRequestView>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            const value = strictChangeRequestReplay(prior.replayValue, ctx.scope);
            const receipt = strictEntityReceipt(prior.receipt, ctx.scope, 'change_request', value.changeRequestId);
            if (receipt.commandKind !== 'M-024' || receipt.inputFingerprint !== hash) return { kind: 'Rejected' as const, error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: receipt };
            if (value.changeRequestId !== input.changeRequestId) throw new Error('반영 receipt의 수정 요청 ID가 다릅니다.');
            return { kind: 'Replayed' as const, value, receipt,
              current: changeBasis(ctx.scope, current.changeRequestId, current.revision) };
          }
          if (!exactChangeGuard(ctx, current)) return rejected('STALE_VERSION', '수정 요청 revision이 바뀌었습니다.', changeBasis(ctx.scope, current.changeRequestId, current.revision));
          if (current.status === 'resolved' || current.currentTargetRef.kind !== 'artifact' ||
            !sameRef(current.currentTargetRef, input.appliedArtifactVersionRef) || !artifactIsCurrent(db, ctx.scope, input.appliedArtifactVersionRef)) {
            return rejected('STALE_VERSION', '현재 반영 대상 문서 version이 다릅니다.', changeBasis(ctx.scope, current.changeRequestId, current.revision));
          }
          if (input.applicationSummary.trim().length === 0) return rejected('VALIDATION_ERROR', '반영 요약이 필요합니다.');
          if (!evidenceInputExists(db, ctx.scope, input.evidence)) return rejected('VALIDATION_ERROR', '반영 evidence ref가 현재 범위에 없습니다.');
          const now = new Date().toISOString();
          const value = appendChangeApplication(db, { scope: ctx.scope, actorId: ctx.actor.actorId, current, value: input, occurredAt: now });
          const resultRef = { kind: 'change_request' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.changeRequestId };
          const saved = { scope: ctx.scope, receiptId: `receipt-${randomUUID()}`, actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId }, commandKind: 'M-024',
            requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash, committedRevision: value.revision,
            resultRefs: [resultRef], committedAt: now } as const;
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertWorkflowActivity(db, { ctx, receiptId: saved.receiptId, eventType: 'change_applied', occurredAt: now,
            description: '수정 반영 결과를 제출했습니다.', refs: [resultRef, input.appliedArtifactVersionRef] });
          return { kind: 'Committed' as const, value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '수정 반영 결과를 저장하지 못했습니다.');
      }
    },
    confirmChangeResolution(ctx, input) {
      const hash = fingerprint('M-025', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (ctx.actor.projectId !== ctx.scope.projectId || readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined) return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          const current = readChangeRequest(db, ctx.scope, input.changeRequestId);
          if (current === undefined) return rejected('NOT_FOUND', '수정 요청을 찾을 수 없습니다.');
          const state = readGateState(db, ctx.scope, current.affectedGate);
          const assignment = state?.assignmentRef === undefined ? undefined : readAssignment(db, state.assignmentRef);
          if (!canReviewChange({ actorId: ctx.actor.actorId, requesterId: current.requesterId,
            currentReviewerIds: assignment?.reviewerIds ?? [] })) return rejected('NOT_ASSIGNED', '원 요청자 또는 현재 검토자만 해결을 확인할 수 있습니다.');
          const prior = readCommandReceipt<ChangeRequestView>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            const value = strictChangeRequestReplay(prior.replayValue, ctx.scope);
            const receipt = strictEntityReceipt(prior.receipt, ctx.scope, 'change_request', value.changeRequestId);
            if (receipt.commandKind !== 'M-025' || receipt.inputFingerprint !== hash) return { kind: 'Rejected' as const, error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: receipt };
            if (value.changeRequestId !== input.changeRequestId) throw new Error('해결 receipt의 수정 요청 ID가 다릅니다.');
            return { kind: 'Replayed' as const, value, receipt,
              current: changeBasis(ctx.scope, current.changeRequestId, current.revision) };
          }
          if (!exactChangeGuard(ctx, current)) return rejected('STALE_VERSION', '수정 요청 revision이 바뀌었습니다.', changeBasis(ctx.scope, current.changeRequestId, current.revision));
          if (current.status !== 'awaiting_confirmation' || current.currentApplicationEventRef === undefined ||
            current.appliedArtifactVersionRef === undefined || !sameRef(current.currentApplicationEventRef, input.applicationEventRef) ||
            !sameRef(current.appliedArtifactVersionRef, input.appliedArtifactVersionRef) ||
            current.currentTargetRef.kind !== 'artifact' || !sameRef(current.currentTargetRef, input.appliedArtifactVersionRef) ||
            !artifactIsCurrent(db, ctx.scope, input.appliedArtifactVersionRef)) {
            return rejected('STALE_VERSION', '현재 application event 또는 반영 문서 version이 다릅니다.', changeBasis(ctx.scope, current.changeRequestId, current.revision));
          }
          if (input.result.verification.trim().length === 0) return rejected('VALIDATION_ERROR', '해결 확인 근거가 필요합니다.');
          const now = new Date().toISOString();
          const value = appendChangeResolution(db, { scope: ctx.scope, actorId: ctx.actor.actorId, current,
            applicationEventRef: input.applicationEventRef, appliedArtifactVersionRef: input.appliedArtifactVersionRef,
            verification: input.result.verification, occurredAt: now });
          const resultRef = { kind: 'change_request' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.changeRequestId };
          const saved = { scope: ctx.scope, receiptId: `receipt-${randomUUID()}`, actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId }, commandKind: 'M-025',
            requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash, committedRevision: value.revision,
            resultRefs: [resultRef], committedAt: now } as const;
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertWorkflowActivity(db, { ctx, receiptId: saved.receiptId, eventType: 'change_resolved', occurredAt: now,
            description: '현재 반영본에서 수정 요청 해결을 확인했습니다.', refs: [resultRef, input.applicationEventRef, input.appliedArtifactVersionRef] });
          return { kind: 'Committed' as const, value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '수정 요청 해결을 확정하지 못했습니다.');
      }
    },
    requestFurtherChange(ctx, input) {
      const hash = fingerprint('M-026', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (ctx.actor.projectId !== ctx.scope.projectId || readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined) return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          const current = readChangeRequest(db, ctx.scope, input.changeRequestId);
          if (current === undefined) return rejected('NOT_FOUND', '수정 요청을 찾을 수 없습니다.');
          const state = readGateState(db, ctx.scope, current.affectedGate);
          const assignment = state?.assignmentRef === undefined ? undefined : readAssignment(db, state.assignmentRef);
          if (!canReviewChange({ actorId: ctx.actor.actorId, requesterId: current.requesterId,
            currentReviewerIds: assignment?.reviewerIds ?? [] })) return rejected('NOT_ASSIGNED', '원 요청자 또는 현재 검토자만 추가 수정을 요청할 수 있습니다.');
          const prior = readCommandReceipt<ChangeRequestView>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            const value = strictChangeRequestReplay(prior.replayValue, ctx.scope);
            const receipt = strictEntityReceipt(prior.receipt, ctx.scope, 'change_request', value.changeRequestId);
            if (receipt.commandKind !== 'M-026' || receipt.inputFingerprint !== hash) return { kind: 'Rejected' as const, error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: receipt };
            if (value.changeRequestId !== input.changeRequestId) throw new Error('추가 수정 receipt의 수정 요청 ID가 다릅니다.');
            return { kind: 'Replayed' as const, value, receipt,
              current: changeBasis(ctx.scope, current.changeRequestId, current.revision) };
          }
          if (!exactChangeGuard(ctx, current)) return rejected('STALE_VERSION', '수정 요청 revision이 바뀌었습니다.', changeBasis(ctx.scope, current.changeRequestId, current.revision));
          if (current.status !== 'awaiting_confirmation' || current.currentApplicationEventRef === undefined ||
            input.currentApplicationEventRef === undefined || !sameRef(current.currentApplicationEventRef, input.currentApplicationEventRef)) {
            return rejected('STALE_VERSION', '현재 확인 대기 application event가 다릅니다.', changeBasis(ctx.scope, current.changeRequestId, current.revision));
          }
          if (input.unresolvedSummary.trim().length === 0 || input.feedback.trim().length === 0) return rejected('VALIDATION_ERROR', '미해결 요약과 추가 수정 내용이 필요합니다.');
          const now = new Date().toISOString();
          const value = appendFurtherChange(db, { scope: ctx.scope, actorId: ctx.actor.actorId, current, value: input, occurredAt: now });
          const resultRef = { kind: 'change_request' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.changeRequestId };
          const saved = { scope: ctx.scope, receiptId: `receipt-${randomUUID()}`, actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId }, commandKind: 'M-026',
            requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash, committedRevision: value.revision,
            resultRefs: [resultRef], committedAt: now } as const;
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertWorkflowActivity(db, { ctx, receiptId: saved.receiptId, eventType: 'change_reopened', occurredAt: now,
            description: '남은 문제를 기록하고 추가 수정을 요청했습니다.', refs: [resultRef, input.currentApplicationEventRef] });
          return { kind: 'Committed' as const, value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '추가 수정 요청을 저장하지 못했습니다.');
      }
    },
    assessGate(ctx, gate) {
      try {
        return persistence.readConsistent((db) => {
          if (ctx.actor.projectId !== ctx.scope.projectId || readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined) {
            throw new WorkspaceServiceError(error('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.'));
          }
          return buildAssessment(db, ctx.scope, gate, options);
        });
      } catch (cause) {
        if (cause instanceof WorkspaceServiceError) throw cause;
        throw new WorkspaceServiceError(error('STORE_UNAVAILABLE', '현재 게이트 조건을 안전하게 읽을 수 없습니다.'));
      }
    },
    transitionStage(ctx, input) {
      const hash = fingerprint('M-028', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          if (ctx.actor.projectId !== ctx.scope.projectId || readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined) return rejected('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
          const before = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (before === undefined) return rejected('NOT_FOUND', 'SR을 찾을 수 없습니다.');
          if (before.ownerId !== ctx.actor.actorId) return rejected('NOT_ASSIGNED', '현재 SR 담당자만 단계를 전환할 수 있습니다.');
          if (input.reason.trim().length === 0 || input.gate === undefined || input.bundleRef === undefined ||
            (input.gate === 'G1' && input.toStage !== 'planning') || (input.gate === 'G2' && input.toStage !== 'ready')) {
            return rejected('VALIDATION_ERROR', '게이트 단계 전환 입력이 올바르지 않습니다.');
          }
          const state = readGateState(db, ctx.scope, input.gate);
          if (state === undefined) return rejected('NOT_FOUND', '검토 gate를 찾을 수 없습니다.');
          const prior = readCommandReceipt<SRView>(db, { scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey });
          if (prior !== undefined) {
            if (prior.receipt.commandKind !== 'M-028' || prior.receipt.inputFingerprint !== hash) return { kind: 'Rejected', error: error('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'), priorReceipt: prior.receipt };
            if (state.validity !== 'valid' || state.needsNewBundle || state.currentBundleRef === undefined || !sameBundle(state.currentBundleRef, input.bundleRef) || state.reviewEpoch !== ctx.guard.expectedReviewEpoch) {
              return { kind: 'Rejected', error: error('GATE_BLOCKED', '이전 전환 후 현재 게이트 기준이 바뀌었습니다.'), priorReceipt: prior.receipt };
            }
            return { kind: 'Replayed', value: strictSrReplay(prior.replayValue, ctx.scope), receipt: prior.receipt,
              current: { target: { kind: 'sr', projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: ctx.scope.srId }, currentRevision: before.revision, allowedActions: [] } };
          }
          const guard = ctx.guard;
          if (guard.resource.target.kind !== 'sr' || guard.resource.target.projectId !== ctx.scope.projectId || guard.resource.target.srId !== ctx.scope.srId ||
            guard.resource.target.entityId !== ctx.scope.srId || guard.resource.expectedRevision !== before.revision) {
            return rejected('STALE_VERSION', 'SR revision이 바뀌었습니다.', { target: { kind: 'sr', projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: ctx.scope.srId }, currentRevision: before.revision, allowedActions: [] });
          }
          if (!sameBundle(guard.expectedBundleRef, input.bundleRef) || guard.expectedReviewEpoch !== state.reviewEpoch || state.currentBundleRef === undefined ||
            !sameBundle(state.currentBundleRef, input.bundleRef) || state.needsNewBundle) return rejected('STALE_BUNDLE', '현재 공식 묶음 또는 review epoch가 바뀌었습니다.', gateBasis(ctx.scope, input.gate, state.revision));
          if ((input.gate === 'G1' && before.progressStage !== 'requirements') || (input.gate === 'G2' && before.progressStage !== 'planning')) {
            return rejected('GATE_BLOCKED', '현재 진행 단계에서 허용된 게이트 전환이 아닙니다.');
          }
          const assessment = buildAssessment(db, ctx.scope, input.gate, options);
          if (!assessment.canTransition) {
            const failed = assessment.conditions.filter((condition) => !condition.passed);
            return { kind: 'Rejected', error: {
              ...error('GATE_BLOCKED', '현재 게이트 조건을 모두 충족하지 못했습니다.'),
              blockers: failed.map((condition) => ({ code: condition.conditionId, reason: condition.reason,
                assigneeIds: condition.assigneeIds, targetRefs: condition.targetRefs })),
              assigneeIds: [...new Set(failed.flatMap((condition) => condition.assigneeIds))],
              targetRefs: [...new Map(failed.flatMap((condition) => condition.targetRefs).map((ref) => [canonical(ref), ref])).values()],
            } };
          }
          const bundle = currentBundle(db, ctx.scope, input.gate);
          if (bundle === undefined) throw new Error('통과할 현재 bundle이 없습니다.');
          const approvals = readApprovals(db, ctx.scope.projectId, ctx.scope.srId)
            .filter((approval) => sameBundle(approval.bundleRef, bundle.bundleRef) && approval.reviewEpoch === bundle.reviewEpoch);
          const now = new Date().toISOString();
          appendGatePass(db, { scope: ctx.scope, gate: input.gate, bundle, approvals, actorId: ctx.actor.actorId,
            reason: input.reason, beforeStage: before.progressStage, afterStage: input.gate === 'G1' ? 'planning' : 'ready',
            assessment, occurredAt: now });
          const value = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (value === undefined) throw new Error('전환한 SR을 읽을 수 없습니다.');
          const saved = { scope: ctx.scope, receiptId: `receipt-${randomUUID()}`, actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
            commandKind: 'M-028', requestId: ctx.requestId, idempotencyKey: ctx.idempotencyKey, inputFingerprint: hash,
            committedRevision: value.revision, resultRefs: [bundle.bundleRef], committedAt: now };
          storeCommandReceipt(db, { receipt: saved, replayValue: value });
          insertWorkflowActivity(db, { ctx, receiptId: saved.receiptId, eventType: 'gate_passed', occurredAt: now,
            description: `${input.gate} 게이트를 통과하고 진행 단계를 전환했습니다.`, refs: [bundle.bundleRef] });
          return { kind: 'Committed', value, receipt: saved };
        });
      } catch {
        return rejected('STORE_UNAVAILABLE', '게이트 단계 전환을 확정하지 못했습니다.');
      }
    },
  };
}
