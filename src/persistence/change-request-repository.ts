import { randomUUID } from 'node:crypto';
import type {
  ArtifactVersionRef, BundleRef, EntityRef, EvidenceRef, GateKind, SrScope,
} from '@/src/contracts/context';
import type {
  ChangeApplication, ChangeFeedback, ChangeRequestEventView, ChangeRequestInput, ChangeRequestTarget,
  ChangeRequestView, CommentInput, CommentView, EvidenceInput,
} from '@/src/contracts/views';
import type { DatabaseConnection } from './database';

export class ChangeRequestRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeRequestRepositoryError';
  }
}

function invalid(message: string): never {
  throw new ChangeRequestRepositoryError(message);
}

function parse(raw: string, label: string): unknown {
  try { return JSON.parse(raw) as unknown; } catch { return invalid(`${label} JSON이 올바르지 않습니다.`); }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(`${label}가 객체가 아닙니다.`);
  return value as Record<string, unknown>;
}

function nonblank(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return invalid(`${label}가 비었습니다.`);
  return value;
}

function positiveVersion(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) return invalid(`${label} version이 올바르지 않습니다.`);
  return value as number;
}

function artifactRef(value: unknown, scope: SrScope, label: string): ArtifactVersionRef {
  const row = object(value, label);
  if (row.kind !== 'artifact' || row.projectId !== scope.projectId || row.srId !== scope.srId ||
    typeof row.entityId !== 'string' || row.entityId.trim().length === 0) return invalid(`${label} 범위가 올바르지 않습니다.`);
  return { kind: 'artifact', projectId: scope.projectId, srId: scope.srId,
    entityId: row.entityId, version: positiveVersion(row.version, label) };
}

function eventRef(value: unknown, scope: SrScope, label: string): EntityRef<'change_request_event'> {
  const row = object(value, label);
  if (row.kind !== 'change_request_event' || row.projectId !== scope.projectId || row.srId !== scope.srId ||
    typeof row.entityId !== 'string' || row.entityId.trim().length === 0) return invalid(`${label}가 올바르지 않습니다.`);
  return { kind: 'change_request_event', projectId: scope.projectId, srId: scope.srId, entityId: row.entityId };
}

function target(value: unknown, scope: SrScope, sectionId: string, artifactId: string): ChangeRequestTarget {
  const row = object(value, '수정 요청 현재 대상');
  if (row.kind === 'missing_section') {
    if (row.sectionId !== sectionId) return invalid('삭제 section 대상이 원 section과 다릅니다.');
    return { kind: 'missing_section', sectionId };
  }
  const ref = artifactRef(row, scope, '수정 요청 현재 artifact');
  if (ref.entityId !== artifactId) return invalid('수정 요청의 원 문서와 현재 문서가 다릅니다.');
  return ref;
}

function externalEvidence(row: Record<string, unknown>): EvidenceRef {
  if (row.kind !== 'external' || typeof row.label !== 'string' || row.label.trim().length === 0 ||
    typeof row.verificationSummary !== 'string' || row.verificationSummary.trim().length === 0 ||
    (row.url !== undefined && typeof row.url !== 'string')) return invalid('외부 evidence가 올바르지 않습니다.');
  return { kind: 'external', label: row.label, verificationSummary: row.verificationSummary,
    ...(row.url === undefined ? {} : { url: row.url as string }) };
}

function versionRefExists(db: DatabaseConnection, ref: Exclude<EvidenceRef, { kind: 'external' }>): boolean {
  if (ref.kind === 'review_policy') {
    return db.prepare(`SELECT 1 FROM review_policy_versions WHERE project_id=? AND policy_id=? AND version=?`)
      .get(ref.projectId, ref.entityId, ref.version) !== undefined;
  }
  const locations: Record<Exclude<typeof ref.kind, 'review_policy'>, readonly [string, string]> = {
    sr_description: ['sr_description_versions', 'description_id'], context_source: ['context_source_versions', 'source_id'],
    artifact: ['artifact_versions', 'artifact_id'], question_answer: ['question_answer_versions', 'answer_id'],
    question_result: ['question_result_versions', 'result_id'], decision: ['decision_versions', 'decision_id'],
    scope_classification: ['scope_classification_versions', 'classification_id'],
    review_assignment: ['review_assignment_versions', 'assignment_id'], handoff: ['handoff_versions', 'handoff_id'],
  };
  const [table, idColumn] = locations[ref.kind];
  return db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? AND sr_id=? AND ${idColumn}=? AND version=?`)
    .get(ref.projectId, ref.srId, ref.entityId, ref.version) !== undefined;
}

function evidence(value: unknown, scope: SrScope, db?: DatabaseConnection): EvidenceInput {
  const row = object(value, '수정 반영 evidence');
  if (typeof row.text === 'string' && row.text.trim().length > 0 && row.refs === undefined) return { text: row.text };
  if (!Array.isArray(row.refs) || row.refs.length === 0 || row.text !== undefined) return invalid('수정 반영 evidence가 올바르지 않습니다.');
  const refs = row.refs.map((item): EvidenceRef => {
    const ref = object(item, 'evidence ref');
    if (ref.kind === 'external') return externalEvidence(ref);
    const versionKinds = new Set(['sr_description', 'context_source', 'artifact', 'question_answer', 'question_result',
      'decision', 'scope_classification', 'review_assignment', 'handoff', 'review_policy']);
    if (typeof ref.kind !== 'string' || !versionKinds.has(ref.kind) || typeof ref.projectId !== 'string' ||
      typeof ref.entityId !== 'string' || ref.entityId.trim().length === 0) return invalid('evidence version ref가 올바르지 않습니다.');
    if (ref.projectId !== scope.projectId || (ref.kind === 'review_policy' ? ref.srId !== undefined : ref.srId !== scope.srId)) {
      return invalid('evidence version ref 범위가 다릅니다.');
    }
    const result: Exclude<EvidenceRef, { kind: 'external' }> = ref.kind === 'review_policy'
      ? { kind: 'review_policy', projectId: scope.projectId, entityId: ref.entityId, version: positiveVersion(ref.version, 'evidence') }
      : { kind: ref.kind as Exclude<Exclude<EvidenceRef, { kind: 'external' }>['kind'], 'review_policy'>,
        projectId: scope.projectId, srId: scope.srId, entityId: ref.entityId,
        version: positiveVersion(ref.version, 'evidence') };
    if (db !== undefined && !versionRefExists(db, result)) return invalid('evidence version ref를 찾을 수 없습니다.');
    return result;
  });
  const first = refs[0];
  if (first === undefined) return invalid('수정 반영 evidence가 비었습니다.');
  return { refs: [first, ...refs.slice(1)] };
}

export function evidenceInputExists(db: DatabaseConnection, scope: SrScope, value: EvidenceInput): boolean {
  try { evidence(value, scope, db); return true; } catch (error) {
    if (error instanceof ChangeRequestRepositoryError) return false;
    throw error;
  }
}

function artifactExists(db: DatabaseConnection, ref: ArtifactVersionRef): boolean {
  return db.prepare(`SELECT 1 FROM artifact_versions WHERE project_id=? AND sr_id=? AND artifact_id=? AND version=?`)
    .get(ref.projectId, ref.srId, ref.entityId, ref.version) !== undefined;
}

function artifactIsCurrent(db: DatabaseConnection, ref: ArtifactVersionRef): boolean {
  return db.prepare(`SELECT 1 FROM artifacts WHERE project_id=? AND sr_id=? AND artifact_id=? AND current_version=?`)
    .get(ref.projectId, ref.srId, ref.entityId, ref.version) !== undefined;
}

function artifactKind(db: DatabaseConnection, ref: ArtifactVersionRef): string {
  const row = db.prepare(`SELECT kind FROM artifact_versions WHERE project_id=? AND sr_id=? AND artifact_id=? AND version=?`)
    .get(ref.projectId, ref.srId, ref.entityId, ref.version) as { readonly kind: string } | undefined;
  if (row === undefined) return invalid('artifact version을 찾을 수 없습니다.');
  return row.kind;
}

function sectionExists(db: DatabaseConnection, ref: ArtifactVersionRef, sectionId: string): boolean {
  return db.prepare(`SELECT 1 FROM artifact_versions v JOIN json_each(v.section_index_json) section
    ON json_extract(section.value,'$.sectionId')=?
    WHERE v.project_id=? AND v.sr_id=? AND v.artifact_id=? AND v.version=?`)
    .get(sectionId, ref.projectId, ref.srId, ref.entityId, ref.version) !== undefined;
}

function bundleRef(value: unknown, scope: SrScope): BundleRef {
  const row = object(value, 'comment bundle ref');
  if ((row.gate !== 'G1' && row.gate !== 'G2') || row.projectId !== scope.projectId || row.srId !== scope.srId ||
    typeof row.bundleId !== 'string' || row.bundleId.trim().length === 0) return invalid('comment bundle ref가 올바르지 않습니다.');
  return { projectId: scope.projectId, srId: scope.srId, gate: row.gate, bundleId: row.bundleId,
    version: positiveVersion(row.version, 'comment bundle') };
}

export function readComments(db: DatabaseConnection, scope: SrScope): readonly CommentView[] {
  const rows = db.prepare(`SELECT comment_id,artifact_id,artifact_kind,artifact_version,section_id,body,author_id,created_at,bundle_ref_json
    FROM comments WHERE project_id=? AND sr_id=? ORDER BY created_at,comment_id`).all(scope.projectId, scope.srId) as Array<{
      comment_id: string; artifact_id: string; artifact_kind: string; artifact_version: number; section_id: string;
      body: string; author_id: string; created_at: string; bundle_ref_json: string | null;
    }>;
  return rows.map((row) => {
    if (!['requirements', 'workflow_plan', 'design', 'implementation_plan'].includes(row.artifact_kind) || row.comment_id.trim().length === 0 || row.section_id.trim().length === 0 ||
      row.body.trim().length === 0 || row.author_id.trim().length === 0) return invalid('저장된 comment가 올바르지 않습니다.');
    const ref: ArtifactVersionRef = { kind: 'artifact', projectId: scope.projectId, srId: scope.srId,
      entityId: row.artifact_id, version: positiveVersion(row.artifact_version, 'comment artifact') };
    if (!sectionExists(db, ref, row.section_id)) return invalid('comment 대상 section을 찾을 수 없습니다.');
    const bundle = row.bundle_ref_json === null ? undefined : bundleRef(parse(row.bundle_ref_json, 'comment bundle'), scope);
    if (bundle !== undefined && db.prepare(`SELECT 1 FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`)
      .get(scope.projectId, scope.srId, bundle.gate, bundle.bundleId, bundle.version) === undefined) return invalid('comment bundle을 찾을 수 없습니다.');
    return { commentId: row.comment_id, artifactVersionRef: ref, sectionId: row.section_id, body: row.body,
      ...(bundle === undefined ? {} : { bundleRef: bundle }), authorId: row.author_id, createdAt: row.created_at };
  });
}

function readEvents(db: DatabaseConnection, scope: SrScope, changeRequestId: string): readonly ChangeRequestEventView[] {
  const rows = db.prepare(`SELECT event_id,kind,actor_id,occurred_at,before_status,after_status,target_artifact_id,target_artifact_kind,target_artifact_version,payload_json
    FROM change_request_events WHERE project_id=? AND sr_id=? AND change_request_id=? ORDER BY rowid`)
    .all(scope.projectId, scope.srId, changeRequestId) as Array<{
      event_id: string; kind: string; actor_id: string; occurred_at: string; before_status: ChangeRequestView['status'];
      after_status: ChangeRequestView['status']; target_artifact_id: string; target_artifact_kind: string;
      target_artifact_version: number; payload_json: string;
    }>;
  return rows.map((row) => {
    if (!['applied', 'resolved', 'further_change', 'carried'].includes(row.kind) ||
      !['requirements', 'workflow_plan', 'design', 'implementation_plan'].includes(row.target_artifact_kind) ||
      !['open', 'awaiting_confirmation', 'resolved'].includes(row.before_status) ||
      !['open', 'awaiting_confirmation', 'resolved'].includes(row.after_status)) return invalid('수정 요청 event 상태가 올바르지 않습니다.');
    const targetRef: ArtifactVersionRef = { kind: 'artifact', projectId: scope.projectId, srId: scope.srId,
      entityId: row.target_artifact_id, version: positiveVersion(row.target_artifact_version, 'event artifact') };
    if (!artifactExists(db, targetRef)) return invalid('수정 요청 event 대상 artifact를 찾을 수 없습니다.');
    const payload = object(parse(row.payload_json, '수정 요청 event'), '수정 요청 event');
    const base = { eventRef: { kind: 'change_request_event' as const, projectId: scope.projectId, srId: scope.srId, entityId: row.event_id },
      changeRequestId,
      kind: row.kind as ChangeRequestEventView['kind'], actorId: row.actor_id, occurredAt: row.occurred_at,
      beforeStatus: row.before_status, afterStatus: row.after_status, targetArtifactVersionRef: targetRef };
    if (row.kind === 'applied') {
      if (row.after_status !== 'awaiting_confirmation' || row.before_status === 'resolved') return invalid('반영 event 상태 전이가 올바르지 않습니다.');
      const applied = artifactRef(payload.appliedArtifactVersionRef, scope, 'applied artifact');
      if (applied.entityId !== targetRef.entityId || applied.version !== targetRef.version ||
        typeof payload.applicationSummary !== 'string' || payload.applicationSummary.trim().length === 0) return invalid('반영 event가 올바르지 않습니다.');
      return { ...base, kind: 'applied', applicationSummary: payload.applicationSummary,
        evidence: evidence(payload.evidence, scope, db) };
    }
    if (row.kind === 'resolved') {
      if (row.before_status !== 'awaiting_confirmation' || row.after_status !== 'resolved') return invalid('해결 event 상태 전이가 올바르지 않습니다.');
      if (typeof payload.verification !== 'string' || payload.verification.trim().length === 0) return invalid('해결 event 근거가 올바르지 않습니다.');
      return { ...base, kind: 'resolved', applicationEventRef: eventRef(payload.applicationEventRef, scope, '해결 application event'),
        verification: payload.verification };
    }
    if (row.kind === 'further_change') {
      if (row.before_status !== 'awaiting_confirmation' || row.after_status !== 'open') return invalid('추가 수정 event 상태 전이가 올바르지 않습니다.');
      if (typeof payload.unresolvedSummary !== 'string' || payload.unresolvedSummary.trim().length === 0 ||
        typeof payload.feedback !== 'string' || payload.feedback.trim().length === 0) return invalid('추가 수정 event가 올바르지 않습니다.');
      return { ...base, kind: 'further_change', unresolvedSummary: payload.unresolvedSummary, feedback: payload.feedback,
        ...(payload.currentApplicationEventRef === undefined ? {} : {
          applicationEventRef: eventRef(payload.currentApplicationEventRef, scope, '추가 수정 application event'),
        }) };
    }
    if (row.before_status !== row.after_status || row.before_status === 'resolved' ||
      typeof payload.sectionId !== 'string' || payload.sectionId.trim().length === 0) return invalid('승계 event 상태가 올바르지 않습니다.');
    return { ...base, kind: 'carried',
      beforeTargetRef: target(payload.beforeTargetRef, scope, String(payload.sectionId), targetRef.entityId),
      afterTargetRef: target(payload.afterTargetRef, scope, String(payload.sectionId), targetRef.entityId) };
  });
}

export function readChangeRequests(db: DatabaseConnection, scope: SrScope): readonly ChangeRequestView[] {
  const rows = db.prepare(`SELECT change_request_id,original_artifact_id,original_artifact_kind,original_artifact_version,
    original_section_id,body,blocking,affected_gate,assignee_id,requester_id,status,current_target_json,revision,
    requested_at,current_application_event_id,current_resolution_event_id,due_at,payload_json
    FROM change_requests WHERE project_id=? AND sr_id=? ORDER BY requested_at,change_request_id`)
    .all(scope.projectId, scope.srId) as Array<{
      change_request_id: string; original_artifact_id: string; original_artifact_kind: string; original_artifact_version: number;
      original_section_id: string; body: string; blocking: number; affected_gate: GateKind; assignee_id: string; requester_id: string;
      status: ChangeRequestView['status']; current_target_json: string; revision: number; requested_at: string;
      current_application_event_id: string | null; current_resolution_event_id: string | null; due_at: string | null;
      payload_json: string;
    }>;
  return rows.map((row) => {
    if (!['requirements', 'workflow_plan', 'design', 'implementation_plan'].includes(row.original_artifact_kind) || row.change_request_id.trim().length === 0 || row.original_section_id.trim().length === 0 ||
      row.body.trim().length === 0 || (row.blocking !== 0 && row.blocking !== 1) || (row.affected_gate !== 'G1' && row.affected_gate !== 'G2') ||
      !['open', 'awaiting_confirmation', 'resolved'].includes(row.status) || !Number.isInteger(row.revision) || row.revision < 1) {
      return invalid('저장된 수정 요청이 올바르지 않습니다.');
    }
    const original: ArtifactVersionRef = { kind: 'artifact', projectId: scope.projectId, srId: scope.srId,
      entityId: row.original_artifact_id, version: positiveVersion(row.original_artifact_version, '원 수정 대상') };
    if (!sectionExists(db, original, row.original_section_id)) return invalid('원 수정 대상 section을 찾을 수 없습니다.');
    const currentTargetRef = target(parse(row.current_target_json, '현재 수정 대상'), scope, row.original_section_id, row.original_artifact_id);
    if (currentTargetRef.kind === 'artifact' && (!artifactExists(db, currentTargetRef) ||
      (row.status !== 'resolved' && !artifactIsCurrent(db, currentTargetRef)))) {
      return invalid('현재 수정 대상이 실제 현재 artifact가 아닙니다.');
    }
    const events = readEvents(db, scope, row.change_request_id);
    const storedPayload = object(parse(row.payload_json, '수정 요청 payload'), '수정 요청 payload');
    const storedBundleRef = storedPayload.bundleRef === undefined ? undefined : bundleRef(storedPayload.bundleRef, scope);
    if (storedBundleRef !== undefined && (storedBundleRef.gate !== row.affected_gate || db.prepare(`SELECT 1 FROM review_bundles
      WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`).get(scope.projectId, scope.srId,
      storedBundleRef.gate, storedBundleRef.bundleId, storedBundleRef.version) === undefined)) {
      return invalid('수정 요청 bundle 관계가 올바르지 않습니다.');
    }
    const currentApplicationEventRef = row.current_application_event_id === null ? undefined :
      { kind: 'change_request_event' as const, projectId: scope.projectId, srId: scope.srId, entityId: row.current_application_event_id };
    const application = currentApplicationEventRef === undefined ? undefined :
      events.find((item) => item.eventRef.entityId === currentApplicationEventRef.entityId && item.kind === 'applied');
    if (currentApplicationEventRef !== undefined && application === undefined) return invalid('현재 application event를 찾을 수 없습니다.');
    const currentResolutionEventRef = row.current_resolution_event_id === null ? undefined :
      { kind: 'change_request_event' as const, projectId: scope.projectId, srId: scope.srId, entityId: row.current_resolution_event_id };
    if (currentResolutionEventRef !== undefined && !events.some((item) => item.eventRef.entityId === currentResolutionEventRef.entityId && item.kind === 'resolved')) {
      return invalid('현재 resolution event를 찾을 수 없습니다.');
    }
    if (row.status === 'awaiting_confirmation' && currentApplicationEventRef === undefined) return invalid('확인 대기 요청에 application event가 없습니다.');
    if (row.status === 'resolved' && currentResolutionEventRef === undefined) return invalid('해결 요청에 resolution event가 없습니다.');
    return {
      changeRequestId: row.change_request_id, originalTargetVersionRef: original, originalSectionId: row.original_section_id,
      body: row.body, blocking: row.blocking === 1, affectedGate: row.affected_gate, assigneeId: row.assignee_id,
      requesterId: row.requester_id, status: row.status, currentTargetRef, revision: row.revision,
      requestedAt: row.requested_at, ...(row.due_at === null ? {} : { dueAt: row.due_at }),
      ...(storedBundleRef === undefined ? {} : { bundleRef: storedBundleRef }),
      ...(currentApplicationEventRef === undefined ? {} : { currentApplicationEventRef }),
      ...(currentResolutionEventRef === undefined ? {} : { currentResolutionEventRef }),
      ...(application === undefined ? {} : { appliedArtifactVersionRef: application.targetArtifactVersionRef }), events,
    };
  });
}

export function readChangeRequest(db: DatabaseConnection, scope: SrScope, id: string): ChangeRequestView | undefined {
  return readChangeRequests(db, scope).find((item) => item.changeRequestId === id);
}

function strictReplayEvent(value: unknown, scope: SrScope, changeRequestId: string, sectionId: string, artifactId: string): ChangeRequestEventView {
  const row = object(value, '수정 요청 replay event');
  const kind = row.kind;
  if (kind !== 'applied' && kind !== 'resolved' && kind !== 'further_change' && kind !== 'carried') return invalid('수정 요청 replay event kind가 올바르지 않습니다.');
  const beforeStatus = row.beforeStatus;
  const afterStatus = row.afterStatus;
  if ((beforeStatus !== 'open' && beforeStatus !== 'awaiting_confirmation' && beforeStatus !== 'resolved') ||
    (afterStatus !== 'open' && afterStatus !== 'awaiting_confirmation' && afterStatus !== 'resolved')) return invalid('수정 요청 replay event 상태가 올바르지 않습니다.');
  const base: Omit<ChangeRequestEventView, 'kind'> = {
    eventRef: eventRef(row.eventRef, scope, '수정 요청 replay event ref'),
    changeRequestId: nonblank(row.changeRequestId, '수정 요청 replay event 요청 ID'),
    actorId: nonblank(row.actorId, '수정 요청 replay actor'),
    occurredAt: nonblank(row.occurredAt, '수정 요청 replay 시각'),
    beforeStatus: beforeStatus as ChangeRequestEventView['beforeStatus'],
    afterStatus: afterStatus as ChangeRequestEventView['afterStatus'],
    targetArtifactVersionRef: artifactRef(row.targetArtifactVersionRef, scope, '수정 요청 replay 대상'),
  };
  if (base.changeRequestId !== changeRequestId) return invalid('수정 요청 replay event의 요청 ID가 다릅니다.');
  if (kind === 'applied') {
    if (base.afterStatus !== 'awaiting_confirmation' || base.beforeStatus === 'resolved') return invalid('수정 반영 replay 상태가 올바르지 않습니다.');
    return { ...base, kind, applicationSummary: nonblank(row.applicationSummary, '수정 반영 요약'), evidence: evidence(row.evidence, scope) };
  }
  if (kind === 'resolved') {
    if (base.beforeStatus !== 'awaiting_confirmation' || base.afterStatus !== 'resolved') return invalid('수정 해결 replay 상태가 올바르지 않습니다.');
    return { ...base, kind, applicationEventRef: eventRef(row.applicationEventRef, scope, '해결 replay application event'), verification: nonblank(row.verification, '해결 확인 근거') };
  }
  if (kind === 'further_change') {
    if (base.beforeStatus !== 'awaiting_confirmation' || base.afterStatus !== 'open') return invalid('추가 수정 replay 상태가 올바르지 않습니다.');
    return { ...base, kind, unresolvedSummary: nonblank(row.unresolvedSummary, '미해결 요약'),
    feedback: nonblank(row.feedback, '추가 수정 내용'), ...(row.applicationEventRef === undefined ? {} : {
      applicationEventRef: eventRef(row.applicationEventRef, scope, '추가 수정 replay application event'),
    }) };
  }
  if (base.beforeStatus !== base.afterStatus || base.beforeStatus === 'resolved') return invalid('승계 replay 상태가 올바르지 않습니다.');
  return { ...base, kind, beforeTargetRef: target(row.beforeTargetRef, scope, sectionId, artifactId),
    afterTargetRef: target(row.afterTargetRef, scope, sectionId, artifactId) };
}

export function strictChangeRequestReplay(value: unknown, scope: SrScope): ChangeRequestView {
  const row = object(value, '수정 요청 replay');
  const originalTargetVersionRef = artifactRef(row.originalTargetVersionRef, scope, '수정 요청 원 대상');
  const changeRequestId = nonblank(row.changeRequestId, '수정 요청 replay ID');
  const originalSectionId = nonblank(row.originalSectionId, '수정 요청 원 section');
  const status = row.status;
  if (status !== 'open' && status !== 'awaiting_confirmation' && status !== 'resolved') return invalid('수정 요청 replay 상태가 올바르지 않습니다.');
  if (row.affectedGate !== 'G1' && row.affectedGate !== 'G2') return invalid('수정 요청 replay gate가 올바르지 않습니다.');
  if (typeof row.blocking !== 'boolean' || !Number.isInteger(row.revision) || (row.revision as number) < 1 || !Array.isArray(row.events)) {
    return invalid('수정 요청 replay 필드가 올바르지 않습니다.');
  }
  const events = row.events.map((item) => strictReplayEvent(item, scope, changeRequestId, originalSectionId, originalTargetVersionRef.entityId));
  const currentApplicationEventRef = row.currentApplicationEventRef === undefined ? undefined :
    eventRef(row.currentApplicationEventRef, scope, '수정 요청 replay current application');
  const currentResolutionEventRef = row.currentResolutionEventRef === undefined ? undefined :
    eventRef(row.currentResolutionEventRef, scope, '수정 요청 replay current resolution');
  const appliedArtifactVersionRef = row.appliedArtifactVersionRef === undefined ? undefined :
    artifactRef(row.appliedArtifactVersionRef, scope, '수정 요청 replay applied artifact');
  const application = currentApplicationEventRef === undefined ? undefined : events.find((item) =>
    item.kind === 'applied' && item.eventRef.entityId === currentApplicationEventRef.entityId);
  if ((status === 'awaiting_confirmation' || status === 'resolved') && (application === undefined || appliedArtifactVersionRef === undefined ||
    application.targetArtifactVersionRef.entityId !== appliedArtifactVersionRef.entityId || application.targetArtifactVersionRef.version !== appliedArtifactVersionRef.version)) {
    return invalid('수정 요청 replay의 현재 반영 근거가 올바르지 않습니다.');
  }
  if (status === 'resolved' && (currentResolutionEventRef === undefined || !events.some((item) =>
    item.kind === 'resolved' && item.eventRef.entityId === currentResolutionEventRef.entityId))) return invalid('수정 요청 replay의 해결 근거가 올바르지 않습니다.');
  const currentTargetRef = target(row.currentTargetRef, scope, originalSectionId, originalTargetVersionRef.entityId);
  const replayBundleRef = row.bundleRef === undefined ? undefined : bundleRef(row.bundleRef, scope);
  if (replayBundleRef !== undefined && replayBundleRef.gate !== row.affectedGate) return invalid('수정 요청 replay bundle gate가 다릅니다.');
  return {
    changeRequestId, originalTargetVersionRef, originalSectionId,
    body: nonblank(row.body, '수정 요청 replay 본문'), affectedGate: row.affectedGate, currentTargetRef, status,
    blocking: row.blocking, assigneeId: nonblank(row.assigneeId, '수정 요청 replay 담당자'),
    requesterId: nonblank(row.requesterId, '수정 요청 replay 요청자'), revision: row.revision as number,
    requestedAt: nonblank(row.requestedAt, '수정 요청 replay 요청 시각'),
    ...(row.dueAt === undefined ? {} : { dueAt: nonblank(row.dueAt, '수정 요청 replay 기한') }),
    ...(replayBundleRef === undefined ? {} : { bundleRef: replayBundleRef }),
    ...(currentApplicationEventRef === undefined ? {} : { currentApplicationEventRef }),
    ...(currentResolutionEventRef === undefined ? {} : { currentResolutionEventRef }),
    ...(appliedArtifactVersionRef === undefined ? {} : { appliedArtifactVersionRef }), events,
  };
}

export function strictCommentReplay(value: unknown, scope: SrScope): CommentView {
  const row = object(value, 'comment replay');
  return {
    commentId: nonblank(row.commentId, 'comment replay ID'),
    artifactVersionRef: artifactRef(row.artifactVersionRef, scope, 'comment replay artifact'),
    sectionId: nonblank(row.sectionId, 'comment replay section'),
    body: nonblank(row.body, 'comment replay 본문'),
    ...(row.bundleRef === undefined ? {} : { bundleRef: bundleRef(row.bundleRef, scope) }),
    authorId: nonblank(row.authorId, 'comment replay 작성자'),
    createdAt: nonblank(row.createdAt, 'comment replay 작성 시각'),
  };
}

export function appendComment(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly actorId: string; readonly value: CommentInput; readonly occurredAt: string;
}): CommentView {
  if (input.value.artifactVersionRef.projectId !== input.scope.projectId || input.value.artifactVersionRef.srId !== input.scope.srId) {
    return invalid('comment 대상 문서 범위가 다릅니다.');
  }
  if (!sectionExists(db, input.value.artifactVersionRef, input.value.sectionId)) return invalid('comment 대상 문서 section을 찾을 수 없습니다.');
  if (input.value.bundleRef !== undefined && (input.value.bundleRef.projectId !== input.scope.projectId ||
    input.value.bundleRef.srId !== input.scope.srId || db.prepare(`SELECT 1 FROM review_bundles
      WHERE project_id=? AND sr_id=? AND gate=? AND bundle_id=? AND version=?`).get(input.scope.projectId, input.scope.srId,
      input.value.bundleRef.gate, input.value.bundleRef.bundleId, input.value.bundleRef.version) === undefined)) {
    return invalid('comment bundle을 찾을 수 없습니다.');
  }
  const commentId = `comment-${randomUUID()}`;
  db.prepare(`INSERT INTO comments(project_id,sr_id,comment_id,artifact_id,artifact_kind,artifact_version,section_id,body,author_id,created_at,bundle_ref_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(input.scope.projectId, input.scope.srId, commentId,
    input.value.artifactVersionRef.entityId, artifactKind(db, input.value.artifactVersionRef), input.value.artifactVersionRef.version,
    input.value.sectionId, input.value.body, input.actorId, input.occurredAt,
    input.value.bundleRef === undefined ? null : JSON.stringify(input.value.bundleRef));
  return { ...input.value, commentId, authorId: input.actorId, createdAt: input.occurredAt };
}

export function appendChangeRequest(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly actorId: string; readonly value: ChangeRequestInput; readonly occurredAt: string;
}): ChangeRequestView {
  if (input.value.artifactVersionRef.projectId !== input.scope.projectId || input.value.artifactVersionRef.srId !== input.scope.srId) {
    return invalid('수정 요청 대상 문서 범위가 다릅니다.');
  }
  if (!sectionExists(db, input.value.artifactVersionRef, input.value.sectionId)) return invalid('수정 요청 대상 section을 찾을 수 없습니다.');
  const currentRow = db.prepare(`SELECT current_version FROM artifacts
    WHERE project_id=? AND sr_id=? AND artifact_id=?`).get(
    input.scope.projectId, input.scope.srId, input.value.artifactVersionRef.entityId,
  ) as { readonly current_version: number } | undefined;
  if (currentRow === undefined) return invalid('수정 요청의 현재 논리 문서를 찾을 수 없습니다.');
  const currentArtifactRef: ArtifactVersionRef = {
    kind: 'artifact', projectId: input.scope.projectId, srId: input.scope.srId,
    entityId: input.value.artifactVersionRef.entityId, version: currentRow.current_version,
  };
  const currentTarget: ChangeRequestTarget = sectionExists(db, currentArtifactRef, input.value.sectionId)
    ? currentArtifactRef
    : { kind: 'missing_section', sectionId: input.value.sectionId };
  const id = `change-${randomUUID()}`;
  db.prepare(`INSERT INTO change_requests(project_id,sr_id,change_request_id,original_artifact_id,original_artifact_kind,
    original_artifact_version,original_section_id,body,blocking,affected_gate,assignee_id,requester_id,status,current_target_json,
    revision,requested_at,current_application_event_id,current_resolution_event_id,due_at,payload_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'open',?,1,?,NULL,NULL,?,?)`).run(
    input.scope.projectId, input.scope.srId, id, input.value.artifactVersionRef.entityId, artifactKind(db, input.value.artifactVersionRef),
    input.value.artifactVersionRef.version, input.value.sectionId, input.value.body, input.value.blocking ? 1 : 0,
    input.value.affectedGate, input.value.assigneeId, input.actorId, JSON.stringify(currentTarget),
    input.occurredAt, input.value.dueAt ?? null, JSON.stringify({ ...(input.value.bundleRef === undefined ? {} : { bundleRef: input.value.bundleRef }),
      originalArtifactVersionRef: input.value.artifactVersionRef }),
  );
  return readChangeRequest(db, input.scope, id) ?? invalid('저장한 수정 요청을 읽을 수 없습니다.');
}

function appendEvent(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly changeRequestId: string; readonly kind: ChangeRequestEventView['kind'];
  readonly actorId: string; readonly occurredAt: string; readonly beforeStatus: ChangeRequestView['status'];
  readonly afterStatus: ChangeRequestView['status']; readonly targetRef: ArtifactVersionRef; readonly payload: object;
}): EntityRef<'change_request_event'> {
  const id = `change-event-${randomUUID()}`;
  db.prepare(`INSERT INTO change_request_events(project_id,sr_id,change_request_id,event_id,kind,actor_id,occurred_at,
    before_status,after_status,target_artifact_id,target_artifact_kind,target_artifact_version,payload_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.scope.projectId, input.scope.srId, input.changeRequestId,
    id, input.kind, input.actorId, input.occurredAt, input.beforeStatus, input.afterStatus,
    input.targetRef.entityId, artifactKind(db, input.targetRef), input.targetRef.version, JSON.stringify(input.payload));
  return { kind: 'change_request_event', projectId: input.scope.projectId, srId: input.scope.srId, entityId: id };
}

export function appendChangeApplication(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly actorId: string; readonly current: ChangeRequestView;
  readonly value: ChangeApplication; readonly occurredAt: string;
}): ChangeRequestView {
  const event = appendEvent(db, { scope: input.scope, changeRequestId: input.current.changeRequestId, kind: 'applied',
    actorId: input.actorId, occurredAt: input.occurredAt, beforeStatus: input.current.status,
    afterStatus: 'awaiting_confirmation', targetRef: input.value.appliedArtifactVersionRef,
    payload: { originalArtifactVersionRef: input.current.originalTargetVersionRef,
      appliedArtifactVersionRef: input.value.appliedArtifactVersionRef,
      applicationSummary: input.value.applicationSummary, evidence: input.value.evidence } });
  const updated = db.prepare(`UPDATE change_requests SET status='awaiting_confirmation',current_application_event_id=?,
    current_resolution_event_id=NULL,revision=revision+1 WHERE project_id=? AND sr_id=? AND change_request_id=? AND revision=?`)
    .run(event.entityId, input.scope.projectId, input.scope.srId, input.current.changeRequestId, input.current.revision);
  if (updated.changes !== 1) return invalid('수정 요청 application 저장 중 현재성이 바뀌었습니다.');
  return readChangeRequest(db, input.scope, input.current.changeRequestId) ?? invalid('반영한 수정 요청을 읽을 수 없습니다.');
}

export function appendChangeResolution(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly actorId: string; readonly current: ChangeRequestView;
  readonly applicationEventRef: EntityRef<'change_request_event'>; readonly appliedArtifactVersionRef: ArtifactVersionRef;
  readonly verification: string; readonly occurredAt: string;
}): ChangeRequestView {
  const event = appendEvent(db, { scope: input.scope, changeRequestId: input.current.changeRequestId, kind: 'resolved',
    actorId: input.actorId, occurredAt: input.occurredAt, beforeStatus: input.current.status, afterStatus: 'resolved',
    targetRef: input.appliedArtifactVersionRef, payload: { applicationEventRef: input.applicationEventRef,
      appliedArtifactVersionRef: input.appliedArtifactVersionRef, verification: input.verification } });
  const updated = db.prepare(`UPDATE change_requests SET status='resolved',current_resolution_event_id=?,revision=revision+1
    WHERE project_id=? AND sr_id=? AND change_request_id=? AND revision=? AND current_application_event_id=?`)
    .run(event.entityId, input.scope.projectId, input.scope.srId, input.current.changeRequestId,
      input.current.revision, input.applicationEventRef.entityId);
  if (updated.changes !== 1) return invalid('수정 요청 해결 저장 중 현재성이 바뀌었습니다.');
  return readChangeRequest(db, input.scope, input.current.changeRequestId) ?? invalid('해결한 수정 요청을 읽을 수 없습니다.');
}

export function appendFurtherChange(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly actorId: string; readonly current: ChangeRequestView;
  readonly value: ChangeFeedback; readonly occurredAt: string;
}): ChangeRequestView {
  const targetRef = input.current.currentTargetRef.kind === 'artifact'
    ? input.current.currentTargetRef : input.current.originalTargetVersionRef;
  appendEvent(db, { scope: input.scope, changeRequestId: input.current.changeRequestId, kind: 'further_change',
    actorId: input.actorId, occurredAt: input.occurredAt, beforeStatus: input.current.status, afterStatus: 'open',
    targetRef, payload: { unresolvedSummary: input.value.unresolvedSummary, feedback: input.value.feedback,
      ...(input.value.currentApplicationEventRef === undefined ? {} : { currentApplicationEventRef: input.value.currentApplicationEventRef }) } });
  const updated = db.prepare(`UPDATE change_requests SET status='open',current_resolution_event_id=NULL,revision=revision+1
    WHERE project_id=? AND sr_id=? AND change_request_id=? AND revision=?`)
    .run(input.scope.projectId, input.scope.srId, input.current.changeRequestId, input.current.revision);
  if (updated.changes !== 1) return invalid('추가 수정 저장 중 현재성이 바뀌었습니다.');
  return readChangeRequest(db, input.scope, input.current.changeRequestId) ?? invalid('추가 수정 요청을 읽을 수 없습니다.');
}

export function carryUnresolvedChangeRequests(db: DatabaseConnection, input: {
  readonly scope: SrScope; readonly artifactVersionRef: ArtifactVersionRef; readonly sectionIds: readonly string[];
  readonly actorId: string; readonly occurredAt: string;
}): void {
  const rows = db.prepare(`SELECT change_request_id,revision,status,original_section_id,current_target_json
    FROM change_requests WHERE project_id=? AND sr_id=? AND original_artifact_id=? AND status IN ('open','awaiting_confirmation')
    ORDER BY change_request_id`).all(input.scope.projectId, input.scope.srId, input.artifactVersionRef.entityId) as Array<{
      change_request_id: string; revision: number; status: ChangeRequestView['status']; original_section_id: string;
      current_target_json: string;
    }>;
  for (const row of rows) {
    const beforeTarget = target(parse(row.current_target_json, '승계 전 수정 대상'), input.scope,
      row.original_section_id, input.artifactVersionRef.entityId);
    const afterTarget: ChangeRequestTarget = input.sectionIds.includes(row.original_section_id)
      ? input.artifactVersionRef : { kind: 'missing_section', sectionId: row.original_section_id };
    appendEvent(db, { scope: input.scope, changeRequestId: row.change_request_id, kind: 'carried', actorId: input.actorId,
      occurredAt: input.occurredAt, beforeStatus: row.status, afterStatus: row.status,
      targetRef: input.artifactVersionRef, payload: { sectionId: row.original_section_id, beforeTargetRef: beforeTarget, afterTargetRef: afterTarget } });
    const updated = db.prepare(`UPDATE change_requests SET current_target_json=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND change_request_id=? AND revision=? AND status IN ('open','awaiting_confirmation')`)
      .run(JSON.stringify(afterTarget), input.scope.projectId, input.scope.srId, row.change_request_id, row.revision);
    if (updated.changes !== 1) return invalid('수정 요청 승계 중 현재성이 바뀌었습니다.');
  }
}
