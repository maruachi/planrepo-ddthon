import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from './database';
import type {
  ContextSourceVersionRef,
  GateKind,
  GateValidity,
  ProgressStage,
  SrDescriptionVersionRef,
  SrVersionRef,
  VersionRef,
} from '@/src/contracts/context';
import type { ReviewImpact } from '@/src/contracts/results';
import {
  assessContextSourceReviewImpact,
  assessDescriptionReviewImpact,
  assessVersionReviewImpact,
  type ContextSourceReviewBasis,
  type DescriptionReviewImpactDecision,
} from '@/src/domain/review-impact';

interface GateRow {
  readonly gate: GateKind;
  readonly validity: GateValidity;
  readonly review_epoch: number;
  readonly last_pass_transition_id: string | null;
}

function currentReviewBasis(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): { readonly gates: readonly GateRow[]; readonly blockingRequestIds: readonly string[] } {
  const gates = db.prepare(
    `SELECT gate,validity,review_epoch,last_pass_transition_id
       FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate`,
  ).all(projectId, srId) as GateRow[];
  if (gates.length !== 2) throw new Error('SR의 G1/G2 현재 상태가 없습니다.');
  const blockingRequestIds = (db.prepare(
    `SELECT change_request_id FROM change_requests
      WHERE project_id=? AND sr_id=? AND blocking=1
        AND status IN ('open','awaiting_confirmation') ORDER BY change_request_id`,
  ).all(projectId, srId) as Array<{ change_request_id: string }>)
    .map((row) => row.change_request_id);
  return { gates, blockingRequestIds };
}

function applyReviewImpact(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly currentStage: ProgressStage;
    readonly changedVersionRef: VersionRef;
    readonly changedPayloadKey: 'changedDescriptionRef' | 'changedSourceRef' | 'changedVersionRef' | 'changedTargetRef';
    readonly reason: string;
    readonly occurredAt: string;
    readonly incrementSrRevision: boolean;
  },
  basis: { readonly gates: readonly GateRow[]; readonly blockingRequestIds: readonly string[] },
  decision: DescriptionReviewImpactDecision,
): { readonly reviewImpact: ReviewImpact; readonly progressStage: ProgressStage } {
  if (!decision.reviewImpact.needsNewReview) return decision;
  for (const gate of basis.gates) {
    if (!decision.reviewImpact.affectedGates.includes(gate.gate)) continue;
    const nextEpoch = gate.review_epoch + 1;
    const validity: GateValidity = gate.last_pass_transition_id === null ? 'not_passed' : 'invalid';
    const transitionId = `transition-${randomUUID()}`;
    if (gate.last_pass_transition_id !== null) {
      db.prepare(
        `INSERT INTO gate_transition_records(
           project_id,sr_id,transition_id,gate,review_epoch,kind,actor_kind,actor_id,
           occurred_at,affected_version_refs_json,bundle_id,bundle_version,payload_json
         ) VALUES (?,?,?,?,?,'invalidated','user',?,?,?,NULL,NULL,?)`,
      ).run(
        input.projectId,
        input.srId,
        transitionId,
        gate.gate,
        nextEpoch,
        input.actorId,
        input.occurredAt,
        JSON.stringify([input.changedVersionRef]),
        JSON.stringify({
          previousPassRef: {
            kind: 'gate_pass',
            projectId: input.projectId,
            srId: input.srId,
            gate: gate.gate,
            transitionId: gate.last_pass_transition_id,
          },
          [input.changedPayloadKey]: input.changedVersionRef,
          affectedGates: decision.reviewImpact.affectedGates,
          reason: input.reason,
        }),
      );
    }
    const impact = {
      ...decision.reviewImpact,
      ...(gate.last_pass_transition_id === null ? {} : { invalidationTransitionId: transitionId }),
    };
    db.prepare(
      `UPDATE review_gate_states
          SET review_epoch=?, needs_new_bundle=1, validity=?, revision=revision+1, impact_json=?
        WHERE project_id=? AND sr_id=? AND gate=?`,
    ).run(nextEpoch, validity, JSON.stringify(impact), input.projectId, input.srId, gate.gate);
  }
  db.prepare(input.incrementSrRevision
    ? 'UPDATE srs SET progress_stage=?,revision=revision+1 WHERE project_id=? AND sr_id=?'
    : 'UPDATE srs SET progress_stage=? WHERE project_id=? AND sr_id=?')
    .run(decision.progressStage, input.projectId, input.srId);
  return decision;
}

export function applyChangeRequestReviewImpact(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly currentStage: ProgressStage;
    readonly changedTargetRef: SrVersionRef;
    readonly blocking: boolean;
    readonly affectedGate: GateKind;
    readonly occurredAt: string;
  },
): { readonly reviewImpact: ReviewImpact; readonly progressStage: ProgressStage } {
  const basis = currentReviewBasis(db, input.projectId, input.srId);
  const affectedGates = input.blocking
    ? input.affectedGate === 'G1' ? ['G1', 'G2'] as const : ['G2'] as const
    : [];
  const decision = assessVersionReviewImpact({
    progressStage: input.currentStage,
    gates: basis.gates,
    blockingRequestIds: basis.blockingRequestIds,
    affectedGates,
  });
  if (!input.blocking) return decision;
  return applyReviewImpact(db, {
    projectId: input.projectId,
    srId: input.srId,
    actorId: input.actorId,
    currentStage: input.currentStage,
    changedVersionRef: input.changedTargetRef,
    changedPayloadKey: 'changedTargetRef',
    reason: '차단 수정 요청이 생겨 영향받는 승인 기준을 다시 검토합니다.',
    occurredAt: input.occurredAt,
    incrementSrRevision: true,
  }, basis, decision);
}

export function applyDescriptionReviewImpact(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly currentStage: ProgressStage;
    readonly changedDescriptionRef: SrDescriptionVersionRef;
    readonly occurredAt: string;
  },
): { readonly reviewImpact: ReviewImpact; readonly progressStage: ProgressStage } {
  const basis = currentReviewBasis(db, input.projectId, input.srId);
  return applyReviewImpact(db, {
    ...input,
    changedVersionRef: input.changedDescriptionRef,
    changedPayloadKey: 'changedDescriptionRef',
    reason: 'SR 설명이 바뀌어 현재 승인 기준을 다시 검토합니다.',
    incrementSrRevision: false,
  }, basis, assessDescriptionReviewImpact({
    progressStage: input.currentStage,
    gates: basis.gates,
    blockingRequestIds: basis.blockingRequestIds,
  }));
}

export function applyContextSourceReviewImpact(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly currentStage: ProgressStage;
    readonly changedSourceRef: ContextSourceVersionRef;
    readonly before?: ContextSourceReviewBasis;
    readonly after: ContextSourceReviewBasis;
    readonly occurredAt: string;
  },
): { readonly reviewImpact: ReviewImpact; readonly progressStage: ProgressStage } {
  const basis = currentReviewBasis(db, input.projectId, input.srId);
  return applyReviewImpact(db, {
    ...input,
    changedVersionRef: input.changedSourceRef,
    changedPayloadKey: 'changedSourceRef',
    reason: '근거 자료의 내용 또는 확인 상태가 바뀌어 현재 승인 기준을 다시 검토합니다.',
    incrementSrRevision: true,
  }, basis, assessContextSourceReviewImpact({
    progressStage: input.currentStage,
    gates: basis.gates,
    blockingRequestIds: basis.blockingRequestIds,
    ...(input.before === undefined ? {} : { before: input.before }),
    after: input.after,
  }));
}

export function applyVersionReviewImpact(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly currentStage: ProgressStage;
    readonly changedVersionRef: SrVersionRef;
    readonly affectedGates: readonly GateKind[];
    readonly reason: string;
    readonly occurredAt: string;
    readonly incrementSrRevision: boolean;
  },
): { readonly reviewImpact: ReviewImpact; readonly progressStage: ProgressStage } {
  if (
    input.changedVersionRef.projectId !== input.projectId ||
    input.changedVersionRef.srId !== input.srId
  ) throw new Error('변경 version ref의 SR 범위가 다릅니다.');
  const basis = currentReviewBasis(db, input.projectId, input.srId);
  const decision = assessVersionReviewImpact({
    progressStage: input.currentStage,
    gates: basis.gates,
    blockingRequestIds: basis.blockingRequestIds,
    affectedGates: input.affectedGates,
  });
  if (!decision.reviewImpact.needsNewReview) {
    if (input.incrementSrRevision) {
      const updated = db.prepare(
        'UPDATE srs SET revision=revision+1 WHERE project_id=? AND sr_id=?',
      ).run(input.projectId, input.srId);
      if (updated.changes !== 1) throw new Error('ReviewImpact 대상 SR을 찾을 수 없습니다.');
    }
    return decision;
  }
  return applyReviewImpact(db, {
    projectId: input.projectId,
    srId: input.srId,
    actorId: input.actorId,
    currentStage: input.currentStage,
    changedVersionRef: input.changedVersionRef,
    changedPayloadKey: 'changedVersionRef',
    reason: input.reason,
    occurredAt: input.occurredAt,
    incrementSrRevision: input.incrementSrRevision,
  }, basis, decision);
}

export function applyReviewConfigurationImpact(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly currentStage: ProgressStage;
    readonly changedVersionRef: VersionRef;
    readonly affectedGates: readonly GateKind[];
    readonly reason: string;
    readonly occurredAt: string;
  },
): { readonly reviewImpact: ReviewImpact; readonly progressStage: ProgressStage } {
  if (
    input.changedVersionRef.projectId !== input.projectId ||
    ('srId' in input.changedVersionRef && input.changedVersionRef.srId !== input.srId)
  ) throw new Error('검토 구성 version ref의 범위가 다릅니다.');
  const basis = currentReviewBasis(db, input.projectId, input.srId);
  const decision = assessVersionReviewImpact({
    progressStage: input.currentStage,
    gates: basis.gates,
    blockingRequestIds: basis.blockingRequestIds,
    affectedGates: input.affectedGates,
  });
  return applyReviewImpact(db, {
    projectId: input.projectId,
    srId: input.srId,
    actorId: input.actorId,
    currentStage: input.currentStage,
    changedVersionRef: input.changedVersionRef,
    changedPayloadKey: 'changedVersionRef',
    reason: input.reason,
    occurredAt: input.occurredAt,
    incrementSrRevision: true,
  }, basis, decision);
}
