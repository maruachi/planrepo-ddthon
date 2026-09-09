import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import type { ArtifactVersionRef } from '@/src/contracts/context';
import type {
  ArtifactEdit, ArtifactView, ChangeRequestView, DraftApplication, DraftArtifactEdit, GenerationResult, SRDetailView,
  WorkflowPlanEdit, WorkflowPlanView,
} from '@/src/contracts/views';
import type { DatabaseConnection } from '@/src/persistence/database';
import { insertDraftReviewFixture } from '@/tests/helpers/draft-review-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const ownerId = manifest.personaIds['P-01'];
const reviewerId = manifest.personaIds['P-03'];
const adminId = manifest.personaIds['P-05'];

function srIdForKey(db: DatabaseConnection, key: string): string {
  const row = db.prepare('SELECT sr_id FROM srs WHERE project_id=? AND sr_key=?')
    .get(projectId, key) as { readonly sr_id: string } | undefined;
  if (row === undefined) throw new Error(`SR not found: ${key}`);
  return row.sr_id;
}

function gateGuard(db: DatabaseConnection, srId: string, gate: 'G1' | 'G2') {
  const row = db.prepare(`SELECT revision,current_bundle_id,current_bundle_version,review_epoch
    FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?`)
    .get(projectId, srId, gate) as {
      readonly revision: number; readonly current_bundle_id: string; readonly current_bundle_version: number;
      readonly review_epoch: number;
    };
  return {
    resource: { target: { kind: 'review_gate_state' as const, projectId, srId, entityId: gate }, expectedRevision: row.revision },
    expectedBundleRef: { projectId, srId, gate, bundleId: row.current_bundle_id, version: row.current_bundle_version },
    expectedReviewEpoch: row.review_epoch,
  };
}

async function detail(app: Awaited<ReturnType<typeof createTestApp>>, srId: string): Promise<SRDetailView> {
  const result = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!result.ok) throw new Error(`SR 조회 실패: ${result.error.code}`);
  return result.value;
}

function currentArtifact(value: SRDetailView, kind: ArtifactView['kind'] = 'requirements'): ArtifactView {
  const artifact = value.artifacts.find((item) => item.kind === kind);
  if (artifact === undefined) throw new Error(`${kind} 문서가 없습니다.`);
  return artifact;
}

function reindex(markdown: string, sections: ArtifactView['sectionIndex']): ArtifactView['sectionIndex'] {
  return sections.map((section, index) => {
    const startOffset = markdown.indexOf(`## ${section.sectionId}`);
    const next = sections[index + 1];
    const endOffset = next === undefined ? markdown.length : markdown.indexOf(`## ${next.sectionId}`, startOffset + 1);
    if (startOffset < 0 || endOffset <= startOffset) throw new Error(`section 재계산 실패: ${section.sectionId}`);
    return { sectionId: section.sectionId, title: section.title, startOffset, endOffset };
  });
}

function currentArtifactEdit(
  artifact: ArtifactView | WorkflowPlanView,
): ArtifactEdit | WorkflowPlanEdit {
  let markdown = artifact.markdown;
  for (const link of artifact.requirementLinks) {
    markdown = markdown.replace(`${link.requirementId}을`, `${link.requirementId} 을`);
  }
  const base = {
    kind: artifact.kind,
    ...('designStage' in artifact && artifact.designStage !== undefined ? { designStage: artifact.designStage } : {}),
    artifactId: artifact.artifactId,
    markdown,
    sectionIndex: reindex(markdown, artifact.sectionIndex),
    requirementLinks: artifact.requirementLinks,
    changeSummary: '미해결 요청 승계 경계를 검증합니다.',
    targetBasis: { kind: 'version' as const, ref: artifact.versionRef },
    decisionRefs: artifact.decisionRefs,
    sourceRefs: artifact.sourceRefs,
    questionResultRefs: artifact.questionResultRefs,
  };
  if (artifact.kind === 'workflow_plan' && 'workflowVersion' in artifact) {
    return { ...base, kind: 'workflow_plan', workflowVersion: artifact.workflowVersion,
      stages: artifact.stages as WorkflowPlanEdit['stages'], implementationUnitCount: 1,
      requirementTaskLinks: artifact.requirementTaskLinks as WorkflowPlanEdit['requirementTaskLinks'] };
  }
  return base as ArtifactEdit;
}

function assignmentReviewer(db: DatabaseConnection, srId: string, gate: 'G1' | 'G2'): string {
  const row = db.prepare(`SELECT r.reviewer_id FROM review_gate_states g
    JOIN review_assignment_reviewers r ON r.project_id=g.project_id AND r.sr_id=g.sr_id AND r.gate=g.gate
      AND r.assignment_id=g.assignment_id AND r.assignment_version=g.assignment_version
    WHERE g.project_id=? AND g.sr_id=? AND g.gate=? ORDER BY r.reviewer_id LIMIT 1`)
    .get(projectId, srId, gate) as { readonly reviewer_id: string } | undefined;
  if (row === undefined) throw new Error(`${gate} 검토자가 없습니다.`);
  return row.reviewer_id;
}

async function requestChange(app: Awaited<ReturnType<typeof createTestApp>>, input: {
  readonly srId: string; readonly key: string; readonly blocking: boolean; readonly artifact: ArtifactView;
  readonly sectionId: string; readonly gate?: 'G1' | 'G2';
}): Promise<ChangeRequestView> {
  const gate = input.gate ?? 'G2';
  const reviewer = assignmentReviewer(app.db, input.srId, gate);
  const guard = gateGuard(app.db, input.srId, gate);
  const result = await app.invoke('M-023', {
    actorId: reviewer, projectId, srId: input.srId, requestId: input.key, idempotencyKey: input.key, guard,
  }, {
    bundleRef: guard.expectedBundleRef, artifactVersionRef: input.artifact.versionRef,
    sectionId: input.sectionId, body: `${input.key} 수정이 필요합니다.`, blocking: input.blocking,
    affectedGate: gate, assigneeId: ownerId,
  });
  if (!result.ok) throw new Error(`수정 요청 실패: ${result.error.code} ${result.error.message}`);
  return result.value;
}

describe('change request workflow', () => {
  it('해결된 요청은 후속 M015 뒤에도 당시 artifact 대상 이력으로 조회합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const before = await detail(app, srId);
      const change = before.changeRequests.find((item) => item.status === 'awaiting_confirmation');
      if (change === undefined || change.currentApplicationEventRef === undefined || change.appliedArtifactVersionRef === undefined) {
        throw new Error('확인 대기 요청이 없습니다.');
      }
      const resolved = await app.invoke('M-025', {
        actorId: change.requesterId, projectId, srId, requestId: 'history-resolve', idempotencyKey: 'history-resolve',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: change.changeRequestId }, expectedRevision: change.revision } },
      }, { changeRequestId: change.changeRequestId, applicationEventRef: change.currentApplicationEventRef,
        appliedArtifactVersionRef: change.appliedArtifactVersionRef,
        result: { kind: 'resolved', verification: '현재 반영본을 확인했습니다.' } });
      expect(resolved).toMatchObject({ ok: true, value: { status: 'resolved' } });
      const artifact = before.artifacts.find((item) => item.artifactId === change.appliedArtifactVersionRef?.entityId);
      if (artifact === undefined) throw new Error('해결 요청의 artifact가 없습니다.');
      const saved = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId, requestId: 'history-after-resolve', idempotencyKey: 'history-after-resolve',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: artifact.artifactId }, expectedRevision: artifact.revision } },
      }, currentArtifactEdit(artifact) as ArtifactEdit);
      expect(saved.ok).toBe(true);
      const after = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(after).toMatchObject({ ok: true, value: { changeRequests: expect.arrayContaining([
        expect.objectContaining({ changeRequestId: change.changeRequestId, status: 'resolved',
          currentTargetRef: change.appliedArtifactVersionRef }),
      ]) } });
    } finally { await app.close(); }
  });

  it('현재 묶음 검토자는 과거 artifact version의 section에도 수정 요청을 남깁니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const before = await detail(app, srId);
      const artifact = currentArtifact(before, 'implementation_plan');
      const section = artifact.sectionIndex[0];
      if (section === undefined) throw new Error('과거 요청 대상 section이 없습니다.');
      const saved = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId, requestId: 'historical-target-save', idempotencyKey: 'historical-target-save',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: artifact.artifactId }, expectedRevision: artifact.revision } },
      }, currentArtifactEdit(artifact) as ArtifactEdit);
      if (!saved.ok) throw new Error(`후속 문서 저장 실패: ${saved.error.code}`);
      const prepared = await detail(app, srId);
      const preparation = prepared.reviewPreparations.find((item) => item.gate === 'G2');
      if (preparation?.kind !== 'Ready') throw new Error('G2 검토 입력이 준비되지 않았습니다.');
      const review = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'historical-target-review', idempotencyKey: 'historical-target-review',
        guard: { resource: { target: { kind: 'review_gate_state', projectId, srId, entityId: 'G2' }, expectedRevision: preparation.gateRevision } },
      }, preparation.input);
      if (!review.ok || review.value.kind !== 'BundleAvailable') throw new Error('G2 검토 요청 실패');
      const reviewer = review.value.bundle.reviewerIds[0];
      if (reviewer === undefined) throw new Error('G2 검토자가 없습니다.');
      const state = gateGuard(app.db, srId, 'G2');
      const requested = await app.invoke('M-023', {
        actorId: reviewer, projectId, srId, requestId: 'historical-target-request', idempotencyKey: 'historical-target-request', guard: state,
      }, { bundleRef: state.expectedBundleRef, artifactVersionRef: artifact.versionRef,
        sectionId: section.sectionId, body: '과거 검토 문서에서 발견한 수정입니다.', blocking: false,
        affectedGate: 'G2', assigneeId: ownerId });
      expect(requested).toMatchObject({ ok: true, value: { originalTargetVersionRef: artifact.versionRef,
        currentTargetRef: saved.value.versionRef, status: 'open' } });
    } finally { await app.close(); }
  });

  it('M017 문서 교체도 미해결 요청을 새 artifact version으로 승계합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const initial = await detail(app, srId);
      const workflow = initial.artifacts.find((item): item is WorkflowPlanView =>
        item.kind === 'workflow_plan' && 'workflowVersion' in item);
      if (workflow === undefined || workflow.sectionIndex[0] === undefined) {
        throw new Error('승계 대상 문서가 없습니다.');
      }
      const workflowChange = await requestChange(app, { srId, key: 'workflow-carry-request', blocking: false,
        artifact: workflow, sectionId: workflow.sectionIndex[0].sectionId });
      const workflowMeta = {
        actorId: ownerId, projectId, srId, requestId: 'workflow-carry-save', idempotencyKey: 'workflow-carry-save',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: workflow.artifactId }, expectedRevision: workflow.revision } },
      } as const;
      const workflowEdit = currentArtifactEdit(workflow) as WorkflowPlanEdit;
      const savedWorkflow = await app.invoke('M-017', workflowMeta, workflowEdit);
      expect(savedWorkflow.ok).toBe(true);
      if (!savedWorkflow.ok) return;
      const workflowAfter = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(workflowAfter).toMatchObject({ ok: true, value: { changeRequests: expect.arrayContaining([
        expect.objectContaining({ changeRequestId: workflowChange.changeRequestId,
          currentTargetRef: savedWorkflow.value.versionRef, revision: workflowChange.revision + 1 }),
      ]) } });
      const replay = await app.invoke('M-017', { ...workflowMeta, requestId: 'workflow-carry-replay' }, workflowEdit);
      expect(replay).toMatchObject({ ok: true, disposition: 'Replayed', value: savedWorkflow.value });
      expect(app.db.prepare(`SELECT count(*) AS n FROM change_request_events
        WHERE project_id=? AND sr_id=? AND kind='carried' AND change_request_id=?`).get(
        projectId, srId, workflowChange.changeRequestId,
      )).toEqual({ n: 1 });
    } finally { await app.close(); }
  });

  it('M018 문서 적용도 미해결 요청을 새 artifact version으로 한 번만 승계합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const currentImplementation = currentArtifact(await detail(app, srId), 'implementation_plan');
      if (currentImplementation.sectionIndex[0] === undefined) throw new Error('승계 대상 section이 없습니다.');
      const implementationChange = await requestChange(app, { srId, key: 'draft-carry-request', blocking: false,
        artifact: currentImplementation, sectionId: currentImplementation.sectionIndex[0]!.sectionId });
      const edit = currentArtifactEdit(currentImplementation) as DraftArtifactEdit;
      if (edit.targetBasis.kind !== 'version') throw new Error('개정 초안 target이 version이 아닙니다.');
      const body: GenerationResult = { schemaVersion: 1, kind: 'artifact', documentKind: 'implementation_plan',
        markdown: edit.markdown, requirementRefs: edit.requirementLinks.map(({ requirementId }) => requirementId),
        changeSummary: edit.changeSummary };
      const draft = insertDraftReviewFixture(app, { actorId: ownerId, projectId, srId }, {
        taskKind: 'ARTIFACT_REVISION', documentKind: 'implementation_plan', targetBasis: edit.targetBasis,
      }, body);
      const draftMeta = {
        actorId: ownerId, projectId, srId, requestId: 'draft-carry-apply', idempotencyKey: 'draft-carry-apply',
        guard: { kind: 'artifact', expectedInputFingerprint: draft.fingerprint,
          target: { target: { kind: 'artifact', projectId, srId, entityId: currentImplementation.artifactId }, expectedRevision: currentImplementation.revision } },
      } as const;
      const application = { draftId: draft.draftId, selectedContent: { kind: 'artifact' as const, edit },
        applicationReason: '현재 문서와 비교했습니다.' } satisfies DraftApplication;
      const applied = await app.invoke('M-018', draftMeta, application);
      expect(applied.ok).toBe(true);
      if (!applied.ok || applied.value.result.kind !== 'artifact') return;
      const after = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(after).toMatchObject({ ok: true, value: { changeRequests: expect.arrayContaining([
        expect.objectContaining({ changeRequestId: implementationChange.changeRequestId,
          currentTargetRef: applied.value.result.artifactVersionRef, revision: implementationChange.revision + 1 }),
      ]) } });
      expect(app.db.prepare(`SELECT count(*) AS n FROM change_request_events
        WHERE project_id=? AND sr_id=? AND kind='carried' AND change_request_id=?`).get(
        projectId, srId, implementationChange.changeRequestId,
      )).toEqual({ n: 1 });
      const replay = await app.invoke('M-018', { ...draftMeta, requestId: 'draft-carry-replay' }, application);
      expect(replay).toMatchObject({ ok: true, disposition: 'Replayed', value: applied.value });
      expect(app.db.prepare(`SELECT count(*) AS n FROM change_request_events
        WHERE project_id=? AND sr_id=? AND kind='carried' AND change_request_id=?`).get(
        projectId, srId, implementationChange.changeRequestId,
      )).toEqual({ n: 1 });
    } finally { await app.close(); }
  });

  it('M017의 늦은 activity 실패는 문서와 요청 승계 및 receipt를 함께 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const before = await detail(app, srId);
      const workflow = before.artifacts.find((item): item is WorkflowPlanView =>
        item.kind === 'workflow_plan' && 'workflowVersion' in item);
      if (workflow === undefined || workflow.sectionIndex[0] === undefined) throw new Error('진행 계획이 없습니다.');
      const change = await requestChange(app, { srId, key: 'workflow-rollback-request', blocking: false,
        artifact: workflow, sectionId: workflow.sectionIndex[0].sectionId });
      app.db.exec(`CREATE TEMP TRIGGER fail_workflow_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='workflow_plan_saved' BEGIN SELECT RAISE(ABORT,'forced workflow activity failure'); END`);
      const result = await app.invoke('M-017', {
        actorId: ownerId, projectId, srId, requestId: 'workflow-rollback-save', idempotencyKey: 'workflow-rollback-save',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: workflow.artifactId }, expectedRevision: workflow.revision } },
      }, currentArtifactEdit(workflow) as WorkflowPlanEdit);
      expect(result).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(app.db.prepare(`SELECT current_version,revision FROM artifacts
        WHERE project_id=? AND sr_id=? AND artifact_id=?`).get(projectId, srId, workflow.artifactId))
        .toEqual({ current_version: workflow.versionRef.version, revision: workflow.revision });
      expect(app.db.prepare(`SELECT revision,current_target_json FROM change_requests
        WHERE project_id=? AND sr_id=? AND change_request_id=?`).get(projectId, srId, change.changeRequestId))
        .toEqual({ revision: change.revision, current_target_json: JSON.stringify(change.currentTargetRef) });
      expect(app.db.prepare(`SELECT count(*) AS n FROM change_request_events
        WHERE project_id=? AND sr_id=? AND kind='carried' AND change_request_id=?`).get(projectId, srId, change.changeRequestId))
        .toEqual({ n: 0 });
      expect(app.db.prepare(`SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?`)
        .get(projectId, 'workflow-rollback-save')).toEqual({ n: 0 });
    } finally { await app.close(); }
  });
  it('검토자에서 제외된 원 요청자도 현재 반영 결과를 확인합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const change = app.db.prepare(`SELECT change_request_id,revision,current_application_event_id,current_target_json
        FROM change_requests WHERE project_id=? AND sr_id=? AND status='awaiting_confirmation'`)
        .get(projectId, srId) as {
          readonly change_request_id: string; readonly revision: number;
          readonly current_application_event_id: string; readonly current_target_json: string;
        };
      const state = app.db.prepare(`SELECT assignment_id,assignment_version FROM review_gate_states
        WHERE project_id=? AND sr_id=? AND gate='G2'`).get(projectId, srId) as {
          readonly assignment_id: string; readonly assignment_version: number;
        };
      const removed = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'change-remove-requester', idempotencyKey: 'change-remove-requester',
        guard: { resource: gateGuard(app.db, srId, 'G2').resource },
      }, {
        gate: 'G2', reviewerIds: [],
        previousAssignmentRef: { kind: 'review_assignment', projectId, srId,
          entityId: state.assignment_id, version: state.assignment_version },
        changeReason: '원 요청자를 현재 검토자 배정에서 제외합니다.',
      });
      if (!removed.ok) throw new Error(`검토자 제거 실패: ${removed.error.code} ${removed.error.message}`);

      const appliedArtifactVersionRef = JSON.parse(change.current_target_json) as ArtifactVersionRef;
      const confirmed = await app.invoke('M-025', {
        actorId: reviewerId, projectId, srId, requestId: 'change-confirm-current', idempotencyKey: 'change-confirm-current',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: change.change_request_id },
          expectedRevision: change.revision } },
      }, {
        changeRequestId: change.change_request_id,
        applicationEventRef: { kind: 'change_request_event', projectId, srId, entityId: change.current_application_event_id },
        appliedArtifactVersionRef,
        result: { kind: 'resolved', verification: '현재 반영 버전에서 요청한 수정을 확인했습니다.' },
      });
      expect(confirmed.ok).toBe(true);
      if (confirmed.ok) expect(confirmed.value.status).toBe('resolved');
    } finally {
      await app.close();
    }
  });

  it('일반 댓글은 gate epoch와 SR revision을 바꾸지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const before = await detail(app, srId);
      const artifact = currentArtifact(before);
      const section = artifact.sectionIndex[0];
      if (section === undefined) throw new Error('댓글 대상 section이 없습니다.');
      const gateBefore = app.db.prepare(`SELECT gate,review_epoch,revision FROM review_gate_states
        WHERE project_id=? AND sr_id=? ORDER BY gate`).all(projectId, srId);
      const added = await app.invoke('M-022', {
        actorId: reviewerId, projectId, srId, requestId: 'comment-no-impact', idempotencyKey: 'comment-no-impact',
      }, { artifactVersionRef: artifact.versionRef, sectionId: section.sectionId, body: '이 문단을 더 명확히 써 주세요.' });
      expect(added.ok).toBe(true);
      expect(app.db.prepare(`SELECT gate,review_epoch,revision FROM review_gate_states
        WHERE project_id=? AND sr_id=? ORDER BY gate`).all(projectId, srId)).toEqual(gateBefore);
      const after = await detail(app, srId);
      expect(after.sr.revision).toBe(before.sr.revision);
      expect(after.comments).toContainEqual(expect.objectContaining({ body: '이 문단을 더 명확히 써 주세요.' }));
    } finally { await app.close(); }
  });

  it('비차단 요청은 승인을 보존하고 차단 요청은 영향 gate만 새 epoch로 전환합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const beforeDetail = await detail(app, srId);
      const artifact = currentArtifact(beforeDetail);
      const section = artifact.sectionIndex[0];
      if (section === undefined) throw new Error('수정 대상 section이 없습니다.');
      const before = app.db.prepare(`SELECT gate,review_epoch,revision,needs_new_bundle,validity FROM review_gate_states
        WHERE project_id=? AND sr_id=? ORDER BY gate`).all(projectId, srId);
      const nonblocking = await requestChange(app, { srId, key: 'nonblocking-change', blocking: false, artifact, sectionId: section.sectionId });
      expect(nonblocking.blocking).toBe(false);
      expect(app.db.prepare(`SELECT gate,review_epoch,revision,needs_new_bundle,validity FROM review_gate_states
        WHERE project_id=? AND sr_id=? ORDER BY gate`).all(projectId, srId)).toEqual(before);
      expect((await detail(app, srId)).sr.revision).toBe(beforeDetail.sr.revision);
      const blocking = await requestChange(app, { srId, key: 'blocking-change', blocking: true, artifact, sectionId: section.sectionId });
      expect(blocking.blocking).toBe(true);
      const after = app.db.prepare(`SELECT gate,review_epoch,needs_new_bundle,validity FROM review_gate_states
        WHERE project_id=? AND sr_id=? ORDER BY gate`).all(projectId, srId) as Array<Record<string, unknown>>;
      expect(after.find((row) => row.gate === 'G1')).toEqual(expect.objectContaining({ review_epoch: 1, needs_new_bundle: 0, validity: 'valid' }));
      expect(after.find((row) => row.gate === 'G2')).toEqual(expect.objectContaining({ review_epoch: 2, needs_new_bundle: 1, validity: 'invalid' }));
    } finally { await app.close(); }
  });

  it('G1 차단 요청은 G1과 종속 G2 epoch를 각각 한 번만 증가시킵니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const artifact = currentArtifact(await detail(app, srId));
      const section = artifact.sectionIndex[0];
      if (section === undefined) throw new Error('수정 대상 section이 없습니다.');
      const before = app.db.prepare(`SELECT gate,review_epoch FROM review_gate_states
        WHERE project_id=? AND sr_id=? ORDER BY gate`).all(projectId, srId) as Array<{ gate: string; review_epoch: number }>;
      await requestChange(app, { srId, key: 'g1-blocking-change', blocking: true, artifact,
        sectionId: section.sectionId, gate: 'G1' });
      const after = app.db.prepare(`SELECT gate,review_epoch,needs_new_bundle,validity FROM review_gate_states
        WHERE project_id=? AND sr_id=? ORDER BY gate`).all(projectId, srId) as Array<Record<string, unknown>>;
      for (const gate of ['G1', 'G2']) {
        const oldState = before.find((item) => item.gate === gate);
        expect(after.find((item) => item.gate === gate)).toEqual(expect.objectContaining({
          review_epoch: (oldState?.review_epoch ?? 0) + 1, needs_new_bundle: 1, validity: 'invalid',
        }));
      }
    } finally { await app.close(); }
  });

  it('현재 반영 event만 추가 수정하거나 해결할 수 있고 반영자만으로는 확인 권한이 생기지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const initial = (await detail(app, srId)).changeRequests.find((item) => item.status === 'awaiting_confirmation');
      if (initial === undefined || initial.currentApplicationEventRef === undefined || initial.appliedArtifactVersionRef === undefined) throw new Error('확인 대기 요청이 없습니다.');
      const assignee = initial.assigneeId;
      const further = await app.invoke('M-026', {
        actorId: initial.requesterId, projectId, srId, requestId: 'further-current', idempotencyKey: 'further-current',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: initial.revision } },
      }, { changeRequestId: initial.changeRequestId, currentApplicationEventRef: initial.currentApplicationEventRef,
        unresolvedSummary: '오류 응답 예시가 부족합니다.', feedback: '구체 예시를 추가해 주세요.' });
      expect(further).toMatchObject({ ok: true, value: { status: 'open' } });
      if (!further.ok || further.value.currentTargetRef.kind !== 'artifact') return;
      const invalidEvidence = await app.invoke('M-024', {
        actorId: assignee, projectId, srId, requestId: 'missing-evidence-ref', idempotencyKey: 'missing-evidence-ref',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: further.value.revision } },
      }, { changeRequestId: initial.changeRequestId, appliedArtifactVersionRef: further.value.currentTargetRef,
        applicationSummary: '존재하지 않는 근거를 연결합니다.', evidence: { refs: [{
          ...further.value.currentTargetRef, version: further.value.currentTargetRef.version + 99,
        }] } });
      expect(invalidEvidence).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      const applied = await app.invoke('M-024', {
        actorId: assignee, projectId, srId, requestId: 'apply-again', idempotencyKey: 'apply-again',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: further.value.revision } },
      }, { changeRequestId: initial.changeRequestId, appliedArtifactVersionRef: further.value.currentTargetRef,
        applicationSummary: '오류 응답 예시를 보완했습니다.', evidence: { text: '현재 문서에서 예시를 확인했습니다.' } });
      expect(applied).toMatchObject({ ok: true, value: { status: 'awaiting_confirmation' } });
      if (!applied.ok || applied.value.currentApplicationEventRef === undefined || applied.value.appliedArtifactVersionRef === undefined) return;
      const staleEvent = await app.invoke('M-025', {
        actorId: initial.requesterId, projectId, srId, requestId: 'old-event-cannot-confirm', idempotencyKey: 'old-event-cannot-confirm',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: applied.value.revision } },
      }, { changeRequestId: initial.changeRequestId, applicationEventRef: initial.currentApplicationEventRef,
        appliedArtifactVersionRef: applied.value.appliedArtifactVersionRef,
        result: { kind: 'resolved', verification: '과거 event로 확인합니다.' } });
      expect(staleEvent).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } });
      const applierOnly = await app.invoke('M-025', {
        actorId: assignee, projectId, srId, requestId: 'applier-cannot-confirm', idempotencyKey: 'applier-cannot-confirm',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: applied.value.revision } },
      }, { changeRequestId: initial.changeRequestId, applicationEventRef: applied.value.currentApplicationEventRef,
        appliedArtifactVersionRef: applied.value.appliedArtifactVersionRef,
        result: { kind: 'resolved', verification: '반영자가 직접 확인합니다.' } });
      expect(applierOnly).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });
      const resolved = await app.invoke('M-025', {
        actorId: initial.requesterId, projectId, srId, requestId: 'requester-confirms', idempotencyKey: 'requester-confirms',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: applied.value.revision } },
      }, { changeRequestId: initial.changeRequestId, applicationEventRef: applied.value.currentApplicationEventRef,
        appliedArtifactVersionRef: applied.value.appliedArtifactVersionRef,
        result: { kind: 'resolved', verification: '현재 반영본에서 요청 내용을 확인했습니다.' } });
      expect(resolved).toMatchObject({ ok: true, value: { status: 'resolved' } });
    } finally { await app.close(); }
  });

  it('M015는 open과 확인 대기인 비차단 요청을 모두 보존하고 삭제 section을 명시합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const before = await detail(app, srId);
      const artifact = currentArtifact(before);
      const section = artifact.sectionIndex[0];
      if (section === undefined) throw new Error('수정 대상 section이 없습니다.');
      const awaitingRequest = await requestChange(app, { srId, key: 'carry-awaiting', blocking: false, artifact, sectionId: section.sectionId });
      const awaiting = await app.invoke('M-024', {
        actorId: ownerId, projectId, srId, requestId: 'carry-apply', idempotencyKey: 'carry-apply',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: awaitingRequest.changeRequestId }, expectedRevision: awaitingRequest.revision } },
      }, { changeRequestId: awaitingRequest.changeRequestId, appliedArtifactVersionRef: artifact.versionRef,
        applicationSummary: '첫 요청을 현재 문서에 반영했습니다.', evidence: { text: '현재 문서를 확인했습니다.' } });
      if (!awaiting.ok) throw new Error(`반영 실패: ${awaiting.error.code}`);
      const open = await requestChange(app, { srId, key: 'carry-open', blocking: false, artifact, sectionId: section.sectionId });
      const keptSections = artifact.sectionIndex.filter((item) => item.sectionId !== section.sectionId);
      const markdown = keptSections.length === 0 ? '# 요구사항\n\n현재 항목을 정리했습니다.\n' : artifact.markdown;
      const saved = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId, requestId: 'carry-artifact-edit', idempotencyKey: 'carry-artifact-edit',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: artifact.artifactId }, expectedRevision: artifact.revision } },
      }, { kind: 'requirements', artifactId: artifact.artifactId, markdown, sectionIndex: keptSections,
        requirementLinks: artifact.requirementLinks.filter((link) => !link.sectionIds.includes(section.sectionId)),
        changeSummary: '요청 대상 section을 제거합니다.', targetBasis: { kind: 'version', ref: artifact.versionRef },
        decisionRefs: artifact.decisionRefs, sourceRefs: artifact.sourceRefs, questionResultRefs: artifact.questionResultRefs });
      expect(saved.ok).toBe(true);
      const changes = (await detail(app, srId)).changeRequests.filter((item) =>
        item.changeRequestId === awaitingRequest.changeRequestId || item.changeRequestId === open.changeRequestId);
      expect(changes).toHaveLength(2);
      expect(changes.find((item) => item.changeRequestId === awaitingRequest.changeRequestId)).toMatchObject({
        status: 'awaiting_confirmation', requesterId: awaitingRequest.requesterId, blocking: false,
        currentTargetRef: { kind: 'missing_section', sectionId: section.sectionId },
      });
      expect(changes.find((item) => item.changeRequestId === open.changeRequestId)).toMatchObject({
        status: 'open', requesterId: open.requesterId, blocking: false,
        currentTargetRef: { kind: 'missing_section', sectionId: section.sectionId },
      });
    } finally { await app.close(); }
  });

  it('M015는 확인 대기인 차단 요청도 현재 artifact version으로 승계하며 해결로 바꾸지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const before = await detail(app, srId);
      const artifact = currentArtifact(before, 'implementation_plan');
      const change = before.changeRequests.find((item) => item.status === 'awaiting_confirmation' && item.blocking);
      if (change === undefined) throw new Error('차단 확인 대기 요청이 없습니다.');
      const markdown = artifact.markdown
        .replace('REQ-AUTH-331을', 'REQ-AUTH-331 을')
        .replace('계정 잠김과 공급자 오류', '계정 잠김과 외부 공급자 오류');
      const saved = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId, requestId: 'carry-blocking', idempotencyKey: 'carry-blocking',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: artifact.artifactId }, expectedRevision: artifact.revision } },
      }, { kind: 'implementation_plan', artifactId: artifact.artifactId, markdown,
        sectionIndex: reindex(markdown, artifact.sectionIndex), requirementLinks: artifact.requirementLinks,
        changeSummary: '인증 오류 설명을 명확히 합니다.', targetBasis: { kind: 'version', ref: artifact.versionRef },
        decisionRefs: artifact.decisionRefs, sourceRefs: artifact.sourceRefs, questionResultRefs: artifact.questionResultRefs });
      if (!saved.ok) throw new Error(`차단 요청 승계용 문서 저장 실패: ${saved.error.code} ${saved.error.message}`);
      const carried = (await detail(app, srId)).changeRequests.find((item) => item.changeRequestId === change.changeRequestId);
      expect(carried).toMatchObject({ status: 'awaiting_confirmation', blocking: true, requesterId: change.requesterId,
        currentTargetRef: saved.value.versionRef });
      expect(carried?.revision).toBe(change.revision + 1);
    } finally { await app.close(); }
  });

  it('후속 상태 변경 뒤에도 receipt 원값을 strict DTO로 재생하고 current만 최신으로 반환합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const initial = (await detail(app, srId)).changeRequests.find((item) => item.status === 'awaiting_confirmation');
      if (initial === undefined || initial.currentApplicationEventRef === undefined) throw new Error('확인 대기 요청이 없습니다.');
      const opened = await app.invoke('M-026', {
        actorId: initial.requesterId, projectId, srId, requestId: 'replay-open', idempotencyKey: 'replay-open',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: initial.revision } },
      }, { changeRequestId: initial.changeRequestId, currentApplicationEventRef: initial.currentApplicationEventRef,
        unresolvedSummary: '한 항목이 남았습니다.', feedback: '다시 반영해 주세요.' });
      if (!opened.ok || opened.value.currentTargetRef.kind !== 'artifact') throw new Error('재개 실패');
      const meta = {
        actorId: opened.value.assigneeId, projectId, srId, requestId: 'replay-apply-first', idempotencyKey: 'replay-apply',
        guard: { resource: { target: { kind: 'change_request' as const, projectId, srId, entityId: initial.changeRequestId }, expectedRevision: opened.value.revision } },
      };
      const input = { changeRequestId: initial.changeRequestId, appliedArtifactVersionRef: opened.value.currentTargetRef,
        applicationSummary: '남은 항목을 반영했습니다.', evidence: { text: '현재 문서에서 확인했습니다.' } };
      const first = await app.invoke('M-024', meta, input);
      if (!first.ok || first.value.currentApplicationEventRef === undefined) throw new Error('반영 실패');
      const later = await app.invoke('M-026', {
        actorId: initial.requesterId, projectId, srId, requestId: 'replay-later-open', idempotencyKey: 'replay-later-open',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: initial.changeRequestId }, expectedRevision: first.value.revision } },
      }, { changeRequestId: initial.changeRequestId, currentApplicationEventRef: first.value.currentApplicationEventRef,
        unresolvedSummary: '추가 확인이 필요합니다.', feedback: '한 번 더 수정해 주세요.' });
      if (!later.ok) throw new Error('후속 수정 실패');
      app.db.exec('DROP TRIGGER command_receipts_no_update');
      app.db.prepare(`UPDATE command_receipts SET replay_value_json=json_set(replay_value_json,
        '$.ownershipToken','CG19_CANARY','$.events[0].rawEnvironment','CG19_NESTED_CANARY'),
        result_refs_json=json_set(result_refs_json,'$[0].rawEnvironment','CG19_RECEIPT_CANARY')
        WHERE project_id=? AND actor_id=? AND idempotency_key=?`).run(projectId, opened.value.assigneeId, 'replay-apply');
      const replay = await app.invoke('M-024', { ...meta, requestId: 'replay-apply-second' }, input);
      expect(replay).toMatchObject({ ok: true, disposition: 'Replayed', value: { status: 'awaiting_confirmation' },
        current: { currentRevision: later.value.revision } });
      expect(JSON.stringify(replay)).not.toContain('CG19_CANARY');
      const conflict = await app.invoke('M-024', { ...meta, requestId: 'replay-apply-conflict' }, {
        ...input, applicationSummary: '같은 key에 다른 반영 내용을 보냅니다.',
      });
      expect(conflict).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
      expect(JSON.stringify(conflict)).not.toContain('CG19_CANARY');
    } finally { await app.close(); }
  });

  it('activity 저장 실패는 해결 상태와 receipt를 함께 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const change = (await detail(app, srId)).changeRequests.find((item) => item.status === 'awaiting_confirmation');
      if (change === undefined || change.currentApplicationEventRef === undefined || change.appliedArtifactVersionRef === undefined) throw new Error('확인 대기 요청이 없습니다.');
      app.db.exec(`CREATE TRIGGER reject_change_resolution_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='change_resolved' BEGIN SELECT RAISE(ABORT,'forced activity failure'); END`);
      const result = await app.invoke('M-025', {
        actorId: change.requesterId, projectId, srId, requestId: 'resolution-rollback', idempotencyKey: 'resolution-rollback',
        guard: { resource: { target: { kind: 'change_request', projectId, srId, entityId: change.changeRequestId }, expectedRevision: change.revision } },
      }, { changeRequestId: change.changeRequestId, applicationEventRef: change.currentApplicationEventRef,
        appliedArtifactVersionRef: change.appliedArtifactVersionRef,
        result: { kind: 'resolved', verification: '현재 반영본을 확인했습니다.' } });
      expect(result).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(app.db.prepare(`SELECT status,revision,current_resolution_event_id FROM change_requests
        WHERE project_id=? AND sr_id=? AND change_request_id=?`).get(projectId, srId, change.changeRequestId)).toEqual({
        status: 'awaiting_confirmation', revision: change.revision, current_resolution_event_id: null,
      });
      expect(app.db.prepare(`SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?`)
        .get(projectId, 'resolution-rollback')).toEqual({ n: 0 });
    } finally { await app.close(); }
  });

  it('차단 요청 activity 실패는 요청·gate 영향·receipt를 모두 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'NOTI-028');
      const artifact = currentArtifact(await detail(app, srId));
      const section = artifact.sectionIndex[0];
      if (section === undefined) throw new Error('수정 대상 section이 없습니다.');
      const reviewer = assignmentReviewer(app.db, srId, 'G2');
      const guard = gateGuard(app.db, srId, 'G2');
      const beforeGate = app.db.prepare(`SELECT review_epoch,needs_new_bundle,validity,revision FROM review_gate_states
        WHERE project_id=? AND sr_id=? AND gate='G2'`).get(projectId, srId);
      const beforeCount = app.db.prepare(`SELECT count(*) AS n FROM change_requests WHERE project_id=? AND sr_id=?`)
        .get(projectId, srId);
      app.db.exec(`CREATE TRIGGER reject_change_request_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='change_requested' BEGIN SELECT RAISE(ABORT,'forced activity failure'); END`);
      const result = await app.invoke('M-023', {
        actorId: reviewer, projectId, srId, requestId: 'request-rollback', idempotencyKey: 'request-rollback', guard,
      }, { bundleRef: guard.expectedBundleRef, artifactVersionRef: artifact.versionRef, sectionId: section.sectionId,
        body: '차단 요청의 원자성을 확인합니다.', blocking: true, affectedGate: 'G2', assigneeId: ownerId });
      expect(result).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(app.db.prepare(`SELECT count(*) AS n FROM change_requests WHERE project_id=? AND sr_id=?`)
        .get(projectId, srId)).toEqual(beforeCount);
      expect(app.db.prepare(`SELECT review_epoch,needs_new_bundle,validity,revision FROM review_gate_states
        WHERE project_id=? AND sr_id=? AND gate='G2'`).get(projectId, srId)).toEqual(beforeGate);
      expect(app.db.prepare(`SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?`)
        .get(projectId, 'request-rollback')).toEqual({ n: 0 });
    } finally { await app.close(); }
  });

  it('M047은 저장된 현재 대상의 범위 오류를 외부 DTO로 노출하지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      app.db.prepare(`UPDATE change_requests SET current_target_json=json_set(current_target_json,
        '$.srId','sr-other','$.ownershipToken','CG19_CANARY') WHERE project_id=? AND sr_id=?`)
        .run(projectId, srId);
      const result = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(result).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(JSON.stringify(result)).not.toContain('CG19_CANARY');
    } finally { await app.close(); }
  });
});
