import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from './database';
import type {
  BundleRef, GateKind, GateValidity, ReviewAssignmentRef, ReviewPolicyVersionRef, SrScope,
} from '@/src/contracts/context';
import type {
  GatePolicy, PolicyEdit, PolicyView, ReviewAssignmentView, ReviewBundleSnapshot,
} from '@/src/contracts/views';
import { validatePolicyEdit } from '@/src/domain/review-policy';

export interface StoredGateState {
  readonly gate: GateKind;
  readonly reviewEpoch: number;
  readonly needsNewBundle: boolean;
  readonly validity: GateValidity;
  readonly revision: number;
  readonly policyRef?: ReviewPolicyVersionRef;
  readonly assignmentRef?: ReviewAssignmentRef;
  readonly currentBundleRef?: BundleRef;
  readonly lastPassTransitionId?: string;
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error(`${label} JSON이 올바르지 않습니다.`); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}가 객체가 아닙니다.`);
  return value as Record<string, unknown>;
}

function parseGatePolicy(value: unknown, label: string): GatePolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}가 객체가 아닙니다.`);
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.requiredRoles) || row.requiredRoles.length === 0 || row.requiredRoles.some((x) => typeof x !== 'string' || x.trim().length === 0)) throw new Error(`${label} requiredRoles가 올바르지 않습니다.`);
  if (!Array.isArray(row.checklist) || row.checklist.length === 0) throw new Error(`${label} checklist가 비었습니다.`);
  const checklist = row.checklist.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`${label} checklist가 올바르지 않습니다.`);
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.itemId !== 'string' || candidate.itemId.trim().length === 0 || typeof candidate.label !== 'string' || candidate.label.trim().length === 0) throw new Error(`${label} checklist 항목이 올바르지 않습니다.`);
    return { itemId: candidate.itemId, label: candidate.label };
  });
  return {
    requiredRoles: row.requiredRoles as unknown as GatePolicy['requiredRoles'],
    checklist: checklist as unknown as GatePolicy['checklist'],
  };
}

export function readPolicy(db: DatabaseConnection, ref: ReviewPolicyVersionRef): PolicyView | undefined {
  const row = db.prepare(
    'SELECT gates_json,description,require_all_assigned,require_distinct_peer FROM review_policy_versions WHERE project_id=? AND policy_id=? AND version=?',
  ).get(ref.projectId, ref.entityId, ref.version) as { gates_json: string; description: string | null; require_all_assigned: number; require_distinct_peer: number } | undefined;
  if (row === undefined) return undefined;
  if (row.require_all_assigned !== 1 || row.require_distinct_peer !== 1) throw new Error('저장된 정책이 필수 검토 조건을 완화합니다.');
  const rawGates = parseObject(row.gates_json, '정책 gates');
  const gates = { G1: parseGatePolicy(rawGates.G1, 'G1 정책'), G2: parseGatePolicy(rawGates.G2, 'G2 정책') };
  const validation = validatePolicyEdit({ gates, requireAllAssigned: true, requireDistinctPeer: true });
  if (validation !== undefined) throw new Error(`저장된 정책이 올바르지 않습니다: ${validation}`);
  return {
    policyRef: ref,
    ...(row.description === null ? {} : { description: row.description }),
    gates,
  };
}

export function readDefaultPolicyRef(db: DatabaseConnection, projectId: string): ReviewPolicyVersionRef | undefined {
  const row = db.prepare('SELECT default_policy_id,default_policy_version FROM workspace_projects WHERE project_id=?')
    .get(projectId) as { default_policy_id: string | null; default_policy_version: number | null } | undefined;
  if (row === undefined || row.default_policy_id === null || row.default_policy_version === null) return undefined;
  return { kind: 'review_policy', projectId, entityId: row.default_policy_id, version: row.default_policy_version };
}

export function readPolicies(db: DatabaseConnection, projectId: string): readonly PolicyView[] {
  const rows = db.prepare('SELECT policy_id,version FROM review_policy_versions WHERE project_id=? ORDER BY policy_id,version')
    .all(projectId) as Array<{ policy_id: string; version: number }>;
  return rows.map((row) => {
    const value = readPolicy(db, { kind: 'review_policy', projectId, entityId: row.policy_id, version: row.version });
    if (value === undefined) throw new Error('정책 목록을 읽는 중 정책이 사라졌습니다.');
    return value;
  });
}

export function appendPolicyVersion(
  db: DatabaseConnection,
  input: { readonly projectId: string; readonly actorId: string; readonly edit: PolicyEdit; readonly createdAt: string },
): PolicyView {
  const previous = 'previousPolicyRef' in input.edit ? input.edit.previousPolicyRef : undefined;
  const policyId = previous?.entityId ?? `policy-${randomUUID()}`;
  const version = (previous?.version ?? 0) + 1;
  db.prepare(
    `INSERT INTO review_policy_versions(project_id,policy_id,version,gates_json,require_all_assigned,require_distinct_peer,created_by,created_at,previous_version,change_reason,description)
     VALUES (?,?,?,?,1,1,?,?,?,?,?)`,
  ).run(input.projectId, policyId, version, JSON.stringify(input.edit.gates), input.actorId, input.createdAt,
    previous?.version ?? null, 'changeReason' in input.edit ? input.edit.changeReason : null, input.edit.description ?? null);
  db.prepare('UPDATE workspace_projects SET default_policy_id=?,default_policy_version=?,revision=revision+1 WHERE project_id=?')
    .run(policyId, version, input.projectId);
  const result = readPolicy(db, { kind: 'review_policy', projectId: input.projectId, entityId: policyId, version });
  if (result === undefined) throw new Error('저장한 정책을 읽을 수 없습니다.');
  return result;
}

export function readGateState(db: DatabaseConnection, scope: SrScope, gate: GateKind): StoredGateState | undefined {
  const row = db.prepare(
    `SELECT review_epoch,needs_new_bundle,validity,revision,policy_id,policy_version,assignment_id,assignment_version,current_bundle_id,current_bundle_version,last_pass_transition_id
       FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?`,
  ).get(scope.projectId, scope.srId, gate) as {
    review_epoch: number; needs_new_bundle: number; validity: GateValidity; revision: number;
    policy_id: string | null; policy_version: number | null; assignment_id: string | null; assignment_version: number | null;
    current_bundle_id: string | null; current_bundle_version: number | null; last_pass_transition_id: string | null;
  } | undefined;
  if (row === undefined) return undefined;
  return {
    gate, reviewEpoch: row.review_epoch, needsNewBundle: row.needs_new_bundle === 1,
    validity: row.validity, revision: row.revision,
    ...(row.policy_id === null || row.policy_version === null ? {} : { policyRef: { kind: 'review_policy' as const, projectId: scope.projectId, entityId: row.policy_id, version: row.policy_version } }),
    ...(row.assignment_id === null || row.assignment_version === null ? {} : { assignmentRef: { kind: 'review_assignment' as const, projectId: scope.projectId, srId: scope.srId, entityId: row.assignment_id, version: row.assignment_version } }),
    ...(row.current_bundle_id === null || row.current_bundle_version === null ? {} : { currentBundleRef: { projectId: scope.projectId, srId: scope.srId, gate, bundleId: row.current_bundle_id, version: row.current_bundle_version } }),
    ...(row.last_pass_transition_id === null ? {} : { lastPassTransitionId: row.last_pass_transition_id }),
  };
}

export function readAssignment(db: DatabaseConnection, ref: ReviewAssignmentRef): ReviewAssignmentView | undefined {
  const row = db.prepare('SELECT gate,description FROM review_assignment_versions WHERE project_id=? AND sr_id=? AND assignment_id=? AND version=?')
    .get(ref.projectId, ref.srId, ref.entityId, ref.version) as { gate: GateKind; description: string | null } | undefined;
  if (row === undefined) return undefined;
  const reviewers = (db.prepare('SELECT reviewer_id FROM review_assignment_reviewers WHERE project_id=? AND sr_id=? AND gate=? AND assignment_id=? AND assignment_version=? ORDER BY reviewer_id')
    .all(ref.projectId, ref.srId, row.gate, ref.entityId, ref.version) as Array<{ reviewer_id: string }>).map((x) => x.reviewer_id);
  return { assignmentRef: ref, gate: row.gate, reviewerIds: reviewers, ready: true };
}

export function appendAssignment(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly gate: GateKind; readonly actorId: string; readonly reviewerIds: readonly string[];
  readonly previous?: ReviewAssignmentRef; readonly changeReason?: string; readonly assignedAt: string;
  readonly ready: boolean; readonly notReadyReason?: string;
}): ReviewAssignmentView {
  const assignmentId = input.previous?.entityId ?? `assignment-${randomUUID()}`;
  const version = (input.previous?.version ?? 0) + 1;
  db.prepare(
    `INSERT INTO review_assignment_versions(project_id,sr_id,gate,assignment_id,version,assigned_by,assigned_at,previous_version,change_reason,description)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.gate, assignmentId, version, input.actorId, input.assignedAt,
    input.previous?.version ?? null, input.changeReason ?? null, null);
  const insert = db.prepare('INSERT INTO review_assignment_reviewers(project_id,sr_id,gate,assignment_id,assignment_version,reviewer_id) VALUES (?,?,?,?,?,?)');
  input.reviewerIds.forEach((reviewer) => insert.run(input.scope.projectId, input.scope.srId, input.gate, assignmentId, version, reviewer));
  return {
    assignmentRef: { kind: 'review_assignment', projectId: input.scope.projectId, srId: input.scope.srId, entityId: assignmentId, version },
    gate: input.gate, reviewerIds: [...input.reviewerIds], ready: input.ready,
    ...(input.ready ? {} : { notReadyReason: input.notReadyReason ?? '검토 준비 조건을 충족하지 못했습니다.' }),
  };
}

export function updateGateConfiguration(db: DatabaseConnection, scope: SrScope, gate: GateKind, refs: {
  readonly policyRef?: ReviewPolicyVersionRef; readonly assignmentRef?: ReviewAssignmentRef;
}): void {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (refs.policyRef !== undefined) { clauses.push('policy_id=?', 'policy_version=?'); args.push(refs.policyRef.entityId, refs.policyRef.version); }
  if (refs.assignmentRef !== undefined) { clauses.push('assignment_id=?', 'assignment_version=?'); args.push(refs.assignmentRef.entityId, refs.assignmentRef.version); }
  if (clauses.length === 0) return;
  db.prepare(`UPDATE review_gate_states SET ${clauses.join(',')} WHERE project_id=? AND sr_id=? AND gate=?`)
    .run(...args, scope.projectId, scope.srId, gate);
}

export function insertReviewBundle(db: DatabaseConnection, input: {
  readonly snapshot: Omit<ReviewBundleSnapshot, 'bundleRef'>; readonly scope: SrScope; readonly gate: GateKind;
  readonly advanceGateRevision?: boolean;
}): { readonly snapshot: ReviewBundleSnapshot; readonly requestIds: readonly string[] } {
  const bundleId = `bundle-${randomUUID()}`;
  const bundleRef: BundleRef = { projectId: input.scope.projectId, srId: input.scope.srId, gate: input.gate, bundleId, version: 1 };
  const s = input.snapshot;
  db.prepare(
    `INSERT INTO review_bundles(project_id,sr_id,gate,bundle_id,version,review_epoch,assignment_id,assignment_version,policy_id,policy_version,checklist_json,created_by,created_at,previous_bundle_id,previous_bundle_version,g1_bundle_id,g1_bundle_version,payload_json)
     VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.gate, bundleId, s.reviewEpoch,
    s.assignmentRef.entityId, s.assignmentRef.version, s.policyRef.entityId, s.policyRef.version,
    JSON.stringify(s.checklistSnapshot), s.createdBy, s.createdAt,
    s.previousBundleRef?.bundleId ?? null, s.previousBundleRef?.version ?? null,
    s.g1BundleRef?.bundleId ?? null, s.g1BundleRef?.version ?? null,
    JSON.stringify({
      artifactVersionRefs: s.artifactVersionRefs, decisionVersionRefs: s.decisionVersionRefs,
      unconfirmedDecisionSnapshots: s.unconfirmedDecisionSnapshots, questionResultRefs: s.questionResultRefs,
      classificationRefs: s.classificationRefs, contextSourceVersionRefs: s.contextSourceVersionRefs,
      assignmentRef: s.assignmentRef, reviewerIds: s.reviewerIds, policyRef: s.policyRef,
      descriptionRef: s.descriptionRef,
    }));
  const requestIds = s.reviewerIds.map((reviewerId) => {
    const requestId = `review-request-${randomUUID()}`;
    db.prepare(
      `INSERT INTO review_requests(project_id,sr_id,request_id,gate,bundle_id,bundle_version,review_epoch,reviewer_id,request_kind,requested_by,requested_at,status,revision,payload_json)
       VALUES (?,?,?,?,?,1,?,?,?, ?,?,'pending',1,'{}')`,
    ).run(input.scope.projectId, input.scope.srId, requestId, input.gate, bundleId, s.reviewEpoch, reviewerId, 'review', s.createdBy, s.createdAt);
    return requestId;
  });
  if (requestIds[0] !== undefined && s.previousBundleRef !== undefined) {
    db.prepare(`UPDATE review_requests SET status='superseded',superseded_by_request_id=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND gate=? AND status='pending' AND bundle_id=? AND bundle_version=?`)
      .run(requestIds[0], input.scope.projectId, input.scope.srId, input.gate,
        s.previousBundleRef.bundleId, s.previousBundleRef.version);
  }
  db.prepare(`UPDATE review_gate_states SET current_bundle_id=?,current_bundle_version=1,needs_new_bundle=0,
    revision=revision+? WHERE project_id=? AND sr_id=? AND gate=?`)
    .run(bundleId, input.advanceGateRevision === true ? 1 : 0, input.scope.projectId, input.scope.srId, input.gate);
  return { snapshot: { bundleRef, ...s }, requestIds };
}
