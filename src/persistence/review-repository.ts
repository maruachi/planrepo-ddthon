import { randomUUID } from 'node:crypto';
import type { BundleRef, EntityRef, GateKind, SrScope } from '@/src/contracts/context';
import type { GateAssessment } from '@/src/contracts/results';
import type { ApprovalView, ChecklistResult, ReviewBundleSnapshot, ReviewRequestView } from '@/src/contracts/views';
import type { DatabaseConnection } from './database';

export class ReviewRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewRepositoryError';
  }
}

function invalid(message: string): never {
  throw new ReviewRepositoryError(message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(`${label}가 객체가 아닙니다.`);
  return value as Record<string, unknown>;
}

function parse(raw: string, label: string): unknown {
  try { return JSON.parse(raw) as unknown; } catch { return invalid(`${label} JSON이 올바르지 않습니다.`); }
}

function bundleRef(projectId: string, srId: string, row: {
  gate: string; bundle_id: string; bundle_version: number;
}): BundleRef {
  if ((row.gate !== 'G1' && row.gate !== 'G2') || row.bundle_id.length === 0 || !Number.isInteger(row.bundle_version) || row.bundle_version < 1) {
    return invalid('검토 bundle ref 저장값이 올바르지 않습니다.');
  }
  return { projectId, srId, gate: row.gate, bundleId: row.bundle_id, version: row.bundle_version };
}

function checklistResults(raw: string): ApprovalView['checklistResults'] {
  const value = parse(raw, 'approval checklist');
  if (!Array.isArray(value) || value.length === 0) return invalid('approval checklist가 비었습니다.');
  const decoded = value.map((item): ChecklistResult => {
    const row = object(item, 'approval checklist item');
    if (typeof row.itemId !== 'string' || row.itemId.trim().length === 0 || row.checked !== true) return invalid('approval checklist item이 올바르지 않습니다.');
    return { itemId: row.itemId, checked: true };
  });
  if (new Set(decoded.map((item) => item.itemId)).size !== decoded.length) return invalid('approval checklist item이 중복됐습니다.');
  const first = decoded[0];
  if (first === undefined) return invalid('approval checklist가 비었습니다.');
  return [first, ...decoded.slice(1)];
}

function resultRef(raw: string | null, projectId: string, srId: string): EntityRef<'approval'> | undefined {
  if (raw === null) return undefined;
  const row = object(parse(raw, 'review request result ref'), 'review request result ref');
  if (row.kind !== 'approval' || row.projectId !== projectId || row.srId !== srId || typeof row.entityId !== 'string' || row.entityId.trim().length === 0) {
    return invalid('review request result ref가 올바르지 않습니다.');
  }
  return { kind: 'approval', projectId, srId, entityId: row.entityId };
}

export function readBundleRequestIds(
  db: DatabaseConnection,
  ref: BundleRef,
  reviewerIds: readonly string[],
): readonly string[] {
  const rows = db.prepare(`SELECT request_id,reviewer_id FROM review_requests
    WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND bundle_version=?`)
    .all(ref.projectId, ref.srId, ref.gate, ref.bundleId, ref.version) as Array<{
      request_id: string; reviewer_id: string;
    }>;
  const byReviewer = new Map(rows.map((row) => [row.reviewer_id, row.request_id]));
  if (rows.length !== reviewerIds.length || reviewerIds.some((id) => !byReviewer.has(id))) {
    return invalid('bundle의 검토 요청 집합이 지정 검토자와 다릅니다.');
  }
  return reviewerIds.map((id) => byReviewer.get(id)!);
}

export function readGateRevision(
  db: DatabaseConnection,
  scope: SrScope,
  gate: GateKind,
): number | undefined {
  return (db.prepare(`SELECT revision FROM review_gate_states
    WHERE project_id=? AND sr_id=? AND gate=?`).get(scope.projectId, scope.srId, gate) as
      { revision: number } | undefined)?.revision;
}

export function readReviewRequests(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): readonly ReviewRequestView[] {
  const rows = db.prepare(`SELECT request_id,gate,bundle_id,bundle_version,review_epoch,reviewer_id,request_kind,
    requested_by,requested_at,status,revision,result_ref_json,handled_at,superseded_by_request_id FROM review_requests
    WHERE project_id=? AND sr_id=? ORDER BY requested_at,request_id`).all(projectId, srId) as Array<{
      request_id: string; gate: string; bundle_id: string; bundle_version: number; review_epoch: number;
      reviewer_id: string; request_kind: string; requested_by: string; requested_at: string;
      status: string; revision: number; result_ref_json: string | null; handled_at: string | null;
      superseded_by_request_id: string | null;
    }>;
  return rows.map((row) => {
    if ((row.status !== 'pending' && row.status !== 'handled' && row.status !== 'superseded') ||
      row.request_id.trim().length === 0 || row.reviewer_id.trim().length === 0 || row.request_kind.trim().length === 0 ||
      row.requested_by.trim().length === 0 || row.requested_at.trim().length === 0 ||
      !Number.isInteger(row.review_epoch) || row.review_epoch < 1 || !Number.isInteger(row.revision) || row.revision < 0) {
      return invalid('review request 저장값이 올바르지 않습니다.');
    }
    const ref = bundleRef(projectId, srId, row);
    if (db.prepare(`SELECT 1 FROM review_bundles b JOIN review_assignment_reviewers r
      ON r.project_id=b.project_id AND r.sr_id=b.sr_id AND r.gate=b.gate
      AND r.assignment_id=b.assignment_id AND r.assignment_version=b.assignment_version
      WHERE b.project_id=? AND b.sr_id=? AND b.gate=? AND b.bundle_id=? AND b.version=?
        AND b.review_epoch=? AND r.reviewer_id=?`).get(
      projectId, srId, ref.gate, ref.bundleId, ref.version, row.review_epoch, row.reviewer_id,
    ) === undefined) return invalid('review request가 bundle 지정 검토자와 다릅니다.');
    const result = resultRef(row.result_ref_json, projectId, srId);
    if ((row.status === 'handled') !== (result !== undefined && row.handled_at !== null)) {
      return invalid('review request 처리 상태가 불완전합니다.');
    }
    if ((row.status === 'superseded') !== (row.superseded_by_request_id !== null)) {
      return invalid('review request 대체 상태가 불완전합니다.');
    }
    if (result !== undefined && db.prepare(`SELECT 1 FROM approvals WHERE project_id=? AND sr_id=? AND approval_id=?
      AND gate=? AND bundle_id=? AND bundle_version=? AND review_epoch=? AND approver_id=?`).get(
      projectId, srId, result.entityId, ref.gate, ref.bundleId, ref.version, row.review_epoch, row.reviewer_id,
    ) === undefined) return invalid('review request 승인 결과 관계가 올바르지 않습니다.');
    return {
      requestId: row.request_id,
      bundleRef: ref,
      reviewEpoch: row.review_epoch,
      reviewerId: row.reviewer_id,
      requestKind: row.request_kind,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      status: row.status,
      revision: row.revision,
      ...(result === undefined ? {} : { resultRef: result }),
      ...(row.handled_at === null ? {} : { handledAt: row.handled_at }),
      ...(row.superseded_by_request_id === null ? {} : { supersededByRequestId: row.superseded_by_request_id }),
    };
  });
}

export function readApprovals(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): readonly ApprovalView[] {
  const rows = db.prepare(`SELECT approval_id,gate,bundle_id,bundle_version,review_epoch,policy_id,policy_version,
    checklist_results_json,approver_id,approval_scope,result,approved_at,comment FROM approvals
    WHERE project_id=? AND sr_id=? ORDER BY approved_at,approval_id`).all(projectId, srId) as Array<{
      approval_id: string; gate: string; bundle_id: string; bundle_version: number; review_epoch: number;
      policy_id: string; policy_version: number; checklist_results_json: string; approver_id: string;
      approval_scope: string; result: string; approved_at: string; comment: string | null;
    }>;
  return rows.map((row) => {
    const ref = bundleRef(projectId, srId, row);
    if (row.approval_scope !== ref.gate || row.result !== 'approved' || !Number.isInteger(row.review_epoch) || row.review_epoch < 1 ||
      !Number.isInteger(row.policy_version) || row.policy_version < 1) return invalid('approval 저장값이 올바르지 않습니다.');
    const results = checklistResults(row.checklist_results_json);
    const bundle = db.prepare(`SELECT checklist_json FROM review_bundles b JOIN review_assignment_reviewers r
      ON r.project_id=b.project_id AND r.sr_id=b.sr_id AND r.gate=b.gate
      AND r.assignment_id=b.assignment_id AND r.assignment_version=b.assignment_version
      WHERE b.project_id=? AND b.sr_id=? AND b.gate=? AND b.bundle_id=? AND b.version=?
        AND b.review_epoch=? AND b.policy_id=? AND b.policy_version=? AND r.reviewer_id=?`).get(
      projectId, srId, ref.gate, ref.bundleId, ref.version, row.review_epoch,
      row.policy_id, row.policy_version, row.approver_id,
    ) as { checklist_json: string } | undefined;
    if (bundle === undefined) return invalid('approval이 bundle 정책·배정과 다릅니다.');
    const rawChecklist = parse(bundle.checklist_json, 'bundle checklist');
    if (!Array.isArray(rawChecklist)) return invalid('bundle checklist가 배열이 아닙니다.');
    const requiredIds = rawChecklist.map((item) => {
      const value = object(item, 'bundle checklist item');
      if (typeof value.itemId !== 'string' || value.itemId.trim().length === 0) return invalid('bundle checklist item이 올바르지 않습니다.');
      return value.itemId;
    });
    if (requiredIds.length !== results.length || !requiredIds.every((id) => results.some((item) => item.itemId === id))) {
      return invalid('approval checklist가 bundle snapshot과 다릅니다.');
    }
    return {
      approvalId: row.approval_id,
      bundleRef: ref,
      reviewEpoch: row.review_epoch,
      policyRef: { kind: 'review_policy', projectId, entityId: row.policy_id, version: row.policy_version },
      approverId: row.approver_id,
      checklistResults: results,
      approvalScope: ref.gate,
      result: 'approved',
      approvedAt: row.approved_at,
      ...(row.comment === null ? {} : { comment: row.comment }),
    };
  });
}

export function appendApproval(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly bundle: ReviewBundleSnapshot;
  readonly approverId: string;
  readonly checklistResults: ApprovalView['checklistResults'];
  readonly comment?: string;
  readonly approvedAt: string;
}): ApprovalView {
  const firstChecklist = input.checklistResults[0];
  const ownedChecklist: ApprovalView['checklistResults'] = [{ itemId: firstChecklist.itemId, checked: true },
    ...input.checklistResults.slice(1).map((item) => ({ itemId: item.itemId, checked: true as const }))];
  const approvalId = `approval-${randomUUID()}`;
  db.prepare(`INSERT INTO approvals(project_id,sr_id,approval_id,gate,bundle_id,bundle_version,review_epoch,
    policy_id,policy_version,checklist_results_json,approver_id,approval_scope,result,approved_at,comment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'approved',?,?)`).run(
    input.scope.projectId, input.scope.srId, approvalId, input.bundle.bundleRef.gate,
    input.bundle.bundleRef.bundleId, input.bundle.bundleRef.version, input.bundle.reviewEpoch,
    input.bundle.policyRef.entityId, input.bundle.policyRef.version, JSON.stringify(ownedChecklist),
    input.approverId, input.bundle.bundleRef.gate, input.approvedAt, input.comment ?? null,
  );
  const approvalRef: EntityRef<'approval'> = {
    kind: 'approval', projectId: input.scope.projectId, srId: input.scope.srId, entityId: approvalId,
  };
  const updated = db.prepare(`UPDATE review_requests SET status='handled',revision=revision+1,result_ref_json=?,handled_at=?
    WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND bundle_version=? AND review_epoch=?
      AND reviewer_id=? AND status='pending'`).run(
    JSON.stringify(approvalRef), input.approvedAt, input.scope.projectId, input.scope.srId,
    input.bundle.bundleRef.gate, input.bundle.bundleRef.bundleId, input.bundle.bundleRef.version,
    input.bundle.reviewEpoch, input.approverId,
  );
  if (updated.changes !== 1) return invalid('현재 검토 요청을 approval과 연결하지 못했습니다.');
  return {
    approvalId,
    bundleRef: input.bundle.bundleRef,
    reviewEpoch: input.bundle.reviewEpoch,
    policyRef: input.bundle.policyRef,
    approverId: input.approverId,
    checklistResults: ownedChecklist,
    approvalScope: input.bundle.bundleRef.gate,
    result: 'approved',
    approvedAt: input.approvedAt,
    ...(input.comment === undefined ? {} : { comment: input.comment }),
  };
}

export function appendGatePass(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly gate: GateKind;
  readonly bundle: ReviewBundleSnapshot;
  readonly approvals: readonly ApprovalView[];
  readonly actorId: string;
  readonly reason: string;
  readonly beforeStage: string;
  readonly afterStage: 'planning' | 'ready';
  readonly assessment: GateAssessment;
  readonly occurredAt: string;
}): string {
  const transitionId = `gate-transition-${randomUUID()}`;
  const approvalRefs = input.approvals.map((approval): EntityRef<'approval'> => ({
    kind: 'approval', projectId: input.scope.projectId, srId: input.scope.srId, entityId: approval.approvalId,
  }));
  db.prepare(`INSERT INTO gate_transition_records(project_id,sr_id,transition_id,gate,review_epoch,kind,actor_kind,
    actor_id,occurred_at,affected_version_refs_json,bundle_id,bundle_version,payload_json)
    VALUES (?,?,?,?,?,'passed','user',?,?,?,?,?,?)`).run(
    input.scope.projectId, input.scope.srId, transitionId, input.gate, input.bundle.reviewEpoch,
    input.actorId, input.occurredAt, JSON.stringify([
      ...input.bundle.artifactVersionRefs,
      ...input.bundle.decisionVersionRefs,
      ...input.bundle.questionResultRefs,
      ...input.bundle.classificationRefs,
      ...input.bundle.contextSourceVersionRefs,
      input.bundle.descriptionRef,
    ]),
    input.bundle.bundleRef.bundleId, input.bundle.bundleRef.version,
    JSON.stringify({
      bundleRef: input.bundle.bundleRef,
      assignmentRef: input.bundle.assignmentRef,
      policyRef: input.bundle.policyRef,
      approvalRefs,
      conditions: input.assessment.conditions,
      reason: input.reason,
      beforeStage: input.beforeStage,
      afterStage: input.afterStage,
    }),
  );
  const gateUpdate = db.prepare(`UPDATE review_gate_states SET validity='valid',needs_new_bundle=0,
    last_pass_transition_id=?,revision=revision+1 WHERE project_id=? AND sr_id=? AND gate=?
      AND review_epoch=? AND current_bundle_id=? AND current_bundle_version=? AND needs_new_bundle=0`).run(
    transitionId, input.scope.projectId, input.scope.srId, input.gate, input.bundle.reviewEpoch,
    input.bundle.bundleRef.bundleId, input.bundle.bundleRef.version,
  );
  if (gateUpdate.changes !== 1) return invalid('현재 gate 통과 상태를 확정하지 못했습니다.');
  const srUpdate = db.prepare(`UPDATE srs SET progress_stage=?,revision=revision+1,updated_at=?
    WHERE project_id=? AND sr_id=? AND progress_stage=?`).run(
    input.afterStage, input.occurredAt, input.scope.projectId, input.scope.srId, input.beforeStage,
  );
  if (srUpdate.changes !== 1) return invalid('SR 진행 단계를 확정하지 못했습니다.');
  return transitionId;
}
