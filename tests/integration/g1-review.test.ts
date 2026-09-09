import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import { prepareCurrentReviewBundle } from '@/src/application/review-bundle-snapshot';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readAssignment, readGateState, readPolicy } from '@/src/persistence/review-policy-repository';
import { createTestApp } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const ownerId = manifest.personaIds['P-01'];
const reviewerId = manifest.personaIds['P-03'];
const requesterId = manifest.personaIds['P-02'];
const adminId = manifest.personaIds['P-05'];
const decisionMakerId = manifest.personaIds['P-04'];

function srIdForKey(db: DatabaseConnection, key: string): string {
  const row = db.prepare('SELECT sr_id FROM srs WHERE project_id=? AND sr_key=?')
    .get(projectId, key) as { readonly sr_id: string } | undefined;
  if (row === undefined) throw new Error(`SR not found: ${key}`);
  return row.sr_id;
}

function gateGuard(db: DatabaseConnection, srId: string, gate: 'G1' | 'G2') {
  const row = db.prepare(
    'SELECT revision FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?',
  ).get(projectId, srId, gate) as { readonly revision: number } | undefined;
  if (row === undefined) throw new Error('gate state missing');
  return {
    resource: {
      target: { kind: 'review_gate_state' as const, projectId, srId, entityId: gate },
      expectedRevision: row.revision,
    },
  };
}

function srGuard(db: DatabaseConnection, srId: string) {
  const row = db.prepare('SELECT revision FROM srs WHERE project_id=? AND sr_id=?')
    .get(projectId, srId) as { readonly revision: number } | undefined;
  if (row === undefined) throw new Error('SR이 없습니다.');
  return {
    resource: {
      target: { kind: 'sr' as const, projectId, srId, entityId: srId },
      expectedRevision: row.revision,
    },
  };
}

async function currentG1(app: Awaited<ReturnType<typeof createTestApp>>, srId: string) {
  const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!detail.ok) throw new Error(`상세 조회 실패: ${detail.error.code}`);
  const currentRef = detail.value.sr.gates.find((item) => item.gate === 'G1')?.currentBundleRef;
  const bundle = detail.value.bundles.find((item) =>
    item.bundleRef.gate === 'G1' && item.bundleRef.bundleId === currentRef?.bundleId &&
    item.bundleRef.version === currentRef?.version);
  if (bundle === undefined) throw new Error('현재 G1 bundle이 없습니다.');
  return bundle;
}

async function moveCurrentQuestionToG2(app: Awaited<ReturnType<typeof createTestApp>>, srId: string) {
  const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
  if (!detail.ok) throw new Error('질문 조회 실패');
  const question = detail.value.questions.find((item) =>
    item.currentClassification.scope === 'current' && item.currentClassification.requiredGate === 'G1' &&
    item.status !== 'resolved' && item.status !== 'converted_to_decision');
  if (question === undefined) throw new Error('미해결 G1 질문이 없습니다.');
  const classified = await app.invoke('M-014', {
    actorId: ownerId, projectId, srId, requestId: 'g1-classify-g2', idempotencyKey: 'g1-classify-g2',
    guard: { resource: { target: { kind: 'question', projectId, srId, entityId: question.questionId },
      expectedRevision: question.revision } },
  }, {
    targetRef: { kind: 'question', projectId, srId, entityId: question.questionId },
    scope: 'current', requiredGate: 'G2', reason: '구현 전 검토에서 해결할 G2 전용 질문입니다.',
  });
  if (!classified.ok) throw new Error(`질문 분류 실패: ${classified.error.code}`);
}

function currentReviewInput(app: Awaited<ReturnType<typeof createTestApp>>, srId: string) {
  const scope = { kind: 'sr' as const, projectId, srId };
  const state = readGateState(app.db, scope, 'G1');
  if (state?.assignmentRef === undefined || state.policyRef === undefined) throw new Error('현재 정책 또는 배정이 없습니다.');
  const assignment = readAssignment(app.db, state.assignmentRef);
  const policy = readPolicy(app.db, state.policyRef);
  if (assignment === undefined || policy === undefined) throw new Error('현재 정책 또는 배정을 읽지 못했습니다.');
  const prepared = prepareCurrentReviewBundle(app.db, {
    scope, gate: 'G1', actorId: ownerId, assignment, policy, createdAt: '2026-09-09T12:00:00.000Z',
  });
  if (prepared.kind !== 'Prepared') throw new Error(`검토 입력 준비 실패: ${prepared.missing.join(', ')}`);
  const snapshot = prepared.snapshot;
  return {
    gate: 'G1' as const, artifactVersionRefs: snapshot.artifactVersionRefs,
    decisionVersionRefs: snapshot.decisionVersionRefs, unconfirmedDecisionSnapshots: snapshot.unconfirmedDecisionSnapshots,
    questionResultRefs: snapshot.questionResultRefs, classificationRefs: snapshot.classificationRefs,
    contextSourceVersionRefs: snapshot.contextSourceVersionRefs, assignmentRef: snapshot.assignmentRef,
    reviewerIds: snapshot.reviewerIds, policyRef: snapshot.policyRef,
  };
}

async function requestFreshG1(app: Awaited<ReturnType<typeof createTestApp>>, srId: string, key: string) {
  const requested = await app.invoke('M-020', {
    actorId: ownerId, projectId, srId, requestId: key, idempotencyKey: key, guard: gateGuard(app.db, srId, 'G1'),
  }, currentReviewInput(app, srId));
  if (!requested.ok || requested.value.kind !== 'BundleAvailable') {
    throw new Error(`검토 요청 실패: ${requested.ok ? requested.value.kind : requested.error.code}`);
  }
  return requested.value.bundle;
}

async function preparePassableG1(app: Awaited<ReturnType<typeof createTestApp>>) {
  const srId = srIdForKey(app.db, 'PAY-102');
  await moveCurrentQuestionToG2(app, srId);
  const bundle = await requestFreshG1(app, srId, 'g1-fresh-request');
  const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
  if (checklist[0] === undefined) throw new Error('체크리스트가 비었습니다.');
  const approval = await app.invoke('M-021', {
    actorId: reviewerId, projectId, srId, requestId: 'g1-success-approval', idempotencyKey: 'g1-success-approval',
    guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
  }, { bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1',
    checklistResults: [checklist[0], ...checklist.slice(1)] });
  if (!approval.ok) throw new Error(`승인 실패: ${approval.error.code}`);
  return { srId, bundle };
}

describe('G1 review workflow', () => {
  it('M047은 쓰기 없이 현재 검토 구성과 그대로 제출할 준비 입력을 제공합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const before = app.db.prepare('SELECT total_changes() AS n').get() as { readonly n: number };
      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      const value = detail.value;
      expect(value.reviewConfigurations).toHaveLength(2);
      expect(value.reviewConfigurations?.[0]).toMatchObject({
        gate: 'G1', validity: 'not_passed', needsNewBundle: false,
        policy: { policyRef: detail.value.bundles.find((item) => item.bundleRef.gate === 'G1')?.policyRef },
        assignment: { gate: 'G1', ready: true },
      });
      expect(value.reviewPreparations).toHaveLength(2);
      const ready = value.reviewPreparations?.find((item) => item.gate === 'G1');
      expect(ready).toMatchObject({ kind: 'Ready', gate: 'G1', input: currentReviewInput(app, srId) });
      if (ready?.kind === 'Ready') expect(ready.checklistSnapshot.length).toBeGreaterThan(0);
      expect(app.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      if (ready?.kind !== 'Ready') return;
      const requested = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'g1-query-prepared', idempotencyKey: 'g1-query-prepared',
        guard: gateGuard(app.db, srId, 'G1'),
      }, ready.input);
      expect(requested.ok).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('현재 검토 기준으로 공식 G1 검토를 요청합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const bundle = await currentG1(app, srId);
      const input = {
        gate: 'G1' as const,
        artifactVersionRefs: bundle.artifactVersionRefs,
        decisionVersionRefs: bundle.decisionVersionRefs,
        unconfirmedDecisionSnapshots: bundle.unconfirmedDecisionSnapshots,
        questionResultRefs: bundle.questionResultRefs,
        classificationRefs: bundle.classificationRefs,
        contextSourceVersionRefs: bundle.contextSourceVersionRefs,
        assignmentRef: bundle.assignmentRef,
        reviewerIds: bundle.reviewerIds,
        policyRef: bundle.policyRef,
      };
      const request = await app.invoke('M-020', {
        actorId: ownerId,
        projectId,
        srId,
        requestId: 'g1-request',
        idempotencyKey: 'g1-request',
        guard: gateGuard(app.db, srId, 'G1'),
      }, input);
      expect(request.ok).toBe(true);
      if (!request.ok || request.value.kind !== 'BundleAvailable') return;
      const before = {
        gate: app.db.prepare('SELECT review_epoch,revision FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
          .get(projectId, srId, 'G1'),
        requests: app.db.prepare('SELECT count(*) AS n FROM review_requests WHERE project_id=? AND sr_id=? AND gate=?')
          .get(projectId, srId, 'G1'),
      };
      const repeated = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'g1-request-new-key', idempotencyKey: 'g1-request-new-key',
        guard: gateGuard(app.db, srId, 'G1'),
      }, input);
      expect(repeated.ok).toBe(true);
      if (repeated.ok) expect(repeated.value).toEqual(request.value);
      expect(app.db.prepare('SELECT review_epoch,revision FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual(before.gate);
      expect(app.db.prepare('SELECT count(*) AS n FROM review_requests WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual(before.requests);
    } finally {
      await app.close();
    }
  });

  it('개별 승인은 남지만 미해결 G1 질문이 평가와 단계 전환을 막습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const bundle = await currentG1(app, srId);
      app.db.prepare('UPDATE srs SET revision=revision+1 WHERE project_id=? AND sr_id=?').run(projectId, srId);
      const before = {
        sr: app.db.prepare('SELECT revision,progress_stage FROM srs WHERE project_id=? AND sr_id=?').get(projectId, srId),
        activities: app.db.prepare('SELECT count(*) AS n FROM activity_events WHERE project_id=? AND sr_id=?').get(projectId, srId),
      };
      const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
      const firstChecklist = checklist[0];
      if (firstChecklist === undefined) throw new Error('체크리스트가 비었습니다.');
      const approval = await app.invoke('M-021', {
        actorId: reviewerId,
        projectId,
        srId,
        requestId: 'g1-approve',
        idempotencyKey: 'g1-approve',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, {
        bundleRef: bundle.bundleRef,
        reviewEpoch: bundle.reviewEpoch,
        approvalScope: 'G1',
        checklistResults: [firstChecklist, ...checklist.slice(1)],
      });
      expect(approval.ok).toBe(true);

      const afterApprovalActivities = app.db.prepare(
        'SELECT count(*) AS n FROM activity_events WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId);
      const assessment = await app.invoke('M-027', { actorId: ownerId, projectId, srId }, 'G1');
      expect(assessment.ok).toBe(true);
      if (assessment.ok) {
        expect(assessment.value.conditions.find((item) => item.conditionId === 'GP-03')).toMatchObject({
          passed: false, assigneeIds: [requesterId],
        });
        expect(assessment.value.conditions.find((item) => item.conditionId === 'GP-07')?.passed).toBe(true);
        expect(assessment.value.canTransition).toBe(false);
      }
      expect(app.db.prepare('SELECT revision,progress_stage FROM srs WHERE project_id=? AND sr_id=?')
        .get(projectId, srId)).toEqual(before.sr);
      expect(app.db.prepare('SELECT count(*) AS n FROM activity_events WHERE project_id=? AND sr_id=?')
        .get(projectId, srId)).toEqual(afterApprovalActivities);

      const guard = srGuard(app.db, srId);
      const transition = await app.invoke('M-028', {
        actorId: ownerId,
        projectId,
        srId,
        requestId: 'g1-pass-blocked',
        idempotencyKey: 'g1-pass-blocked',
        guard: { ...guard, expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, { toStage: 'planning', reason: 'G1 검토 조건을 확인했습니다.', gate: 'G1', bundleRef: bundle.bundleRef });
      expect(transition.ok).toBe(false);
      if (!transition.ok) expect(transition.error.code).toBe('GATE_BLOCKED');
      expect(app.db.prepare('SELECT progress_stage FROM srs WHERE project_id=? AND sr_id=?')
        .get(projectId, srId)).toEqual({ progress_stage: 'requirements' });
    } finally {
      await app.close();
    }
  });

  it('현재 조건 전부를 transaction에서 재검사해 G1을 통과하고 원 결과를 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { srId, bundle } = await preparePassableG1(app);

      const assessment = await app.invoke('M-027', { actorId: ownerId, projectId, srId }, 'G1');
      expect(assessment.ok).toBe(true);
      if (assessment.ok) expect(assessment.value.canTransition).toBe(true);
      const guard = srGuard(app.db, srId);
      const meta = {
        actorId: ownerId, projectId, srId, requestId: 'g1-transition', idempotencyKey: 'g1-transition',
        guard: { ...guard, expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      };
      const input = { toStage: 'planning' as const, reason: '현재 G1 조건을 모두 확인했습니다.',
        gate: 'G1' as const, bundleRef: bundle.bundleRef };
      const first = await app.invoke('M-028', meta, input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.progressStage).toBe('planning');
      expect(first.value.gates.find((item) => item.gate === 'G1')?.validity).toBe('valid');
      expect(first.value.gates.find((item) => item.gate === 'G2')?.validity).not.toBe('valid');
      const pass = app.db.prepare(`SELECT affected_version_refs_json,payload_json FROM gate_transition_records
        WHERE project_id=? AND sr_id=? AND gate='G1' AND kind='passed'`).get(projectId, srId) as {
          affected_version_refs_json: string; payload_json: string;
        };
      expect(JSON.parse(pass.affected_version_refs_json)).toEqual(expect.arrayContaining([
        bundle.descriptionRef, ...bundle.artifactVersionRefs, ...bundle.decisionVersionRefs,
      ]));
      expect(JSON.parse(pass.payload_json)).toMatchObject({
        bundleRef: bundle.bundleRef,
        conditions: expect.arrayContaining([
          expect.objectContaining({ conditionId: 'GP-01', passed: true }),
          expect.objectContaining({ conditionId: 'GP-09', passed: true }),
        ]),
        approvalRefs: [expect.objectContaining({ kind: 'approval' })],
      });

      app.db.exec('DROP TRIGGER command_receipts_no_update');
      const receipt = app.db.prepare('SELECT replay_value_json FROM command_receipts WHERE project_id=? AND actor_id=? AND idempotency_key=?')
        .get(projectId, ownerId, 'g1-transition') as { replay_value_json: string };
      const poisoned = JSON.parse(receipt.replay_value_json) as Record<string, unknown>;
      poisoned.ownershipToken = 'CG18_CANARY';
      poisoned.gates = (poisoned.gates as Array<Record<string, unknown>>).map((gate) => ({
        ...gate,
        currentBundleRef: gate.currentBundleRef === undefined ? undefined : {
          ...(gate.currentBundleRef as Record<string, unknown>), rawEnvironment: 'CG18_CANARY',
        },
      }));
      app.db.prepare('UPDATE command_receipts SET replay_value_json=? WHERE project_id=? AND actor_id=? AND idempotency_key=?')
        .run(JSON.stringify(poisoned), projectId, ownerId, 'g1-transition');

      const replay = await app.invoke('M-028', { ...meta, requestId: 'g1-transition-retry' }, input);
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        expect(replay.disposition).toBe('Replayed');
        expect(replay.value).toEqual(first.value);
        expect(JSON.stringify(replay.value)).not.toContain('CG18_CANARY');
      }
      const competing = await app.invoke('M-028', {
        ...meta, requestId: 'g1-transition-competing', idempotencyKey: 'g1-transition-competing',
      }, input);
      expect(competing).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } });
      expect(app.db.prepare(`SELECT count(*) AS n FROM gate_transition_records
        WHERE project_id=? AND sr_id=? AND gate='G1' AND kind='passed'`).get(projectId, srId)).toEqual({ n: 1 });
      const repeatedAfterPass = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'g1-request-after-pass', idempotencyKey: 'g1-request-after-pass',
        guard: gateGuard(app.db, srId, 'G1'),
      }, currentReviewInput(app, srId));
      expect(repeatedAfterPass).toMatchObject({ ok: true, value: { kind: 'BundleAvailable', bundle } });
      expect(app.db.prepare('SELECT progress_stage FROM srs WHERE project_id=? AND sr_id=?').get(projectId, srId))
        .toEqual({ progress_stage: 'planning' });
      expect(app.db.prepare(`SELECT validity,needs_new_bundle FROM review_gate_states
        WHERE project_id=? AND sr_id=? AND gate='G1'`).get(projectId, srId))
        .toEqual({ validity: 'valid', needs_new_bundle: 0 });
    } finally {
      await app.close();
    }
  });

  it('필수 문서가 없는 최초 배정은 공식 요청을 거절하고 부분 bundle을 남기지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const created = await app.invoke('M-003', {
        actorId: ownerId, projectId, requestId: 'g1-empty-sr', idempotencyKey: 'g1-empty-sr',
      }, { key: 'G1-EMPTY', title: '문서 없는 G1', purpose: '준비 실패 검사', description: '아직 문서가 없습니다.', ownerId });
      if (!created.ok) throw new Error('SR 등록 실패');
      const srId = created.value.scope.srId;
      const assigned = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'g1-empty-assign', idempotencyKey: 'g1-empty-assign',
        guard: gateGuard(app.db, srId, 'G1'),
      }, { gate: 'G1', reviewerIds: [reviewerId] });
      if (!assigned.ok) throw new Error('검토자 배정 실패');
      const workspace = await app.invoke('M-001', { actorId: ownerId, projectId }, {});
      if (!workspace.ok || workspace.value.defaultPolicyRef === undefined) throw new Error('정책 조회 실패');
      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.value.reviewPreparations.find((item) => item.gate === 'G1')).toMatchObject({
          kind: 'NeedsInputs',
          missing: expect.arrayContaining(['requirements 문서가 필요합니다.']),
          assigneeIds: expect.arrayContaining([ownerId]),
        });
        expect(detail.value.reviewConfigurations.find((item) => item.gate === 'G1')).toMatchObject({
          policy: { policyRef: workspace.value.defaultPolicyRef },
          assignment: { assignmentRef: assigned.value.assignmentRef },
        });
      }
      const result = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'g1-empty-request', idempotencyKey: 'g1-empty-request',
        guard: gateGuard(app.db, srId, 'G1'),
      }, { gate: 'G1', artifactVersionRefs: [], decisionVersionRefs: [], unconfirmedDecisionSnapshots: [],
        questionResultRefs: [], classificationRefs: [], contextSourceVersionRefs: [],
        assignmentRef: assigned.value.assignmentRef, reviewerIds: assigned.value.reviewerIds,
        policyRef: workspace.value.defaultPolicyRef });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GATE_BLOCKED');
        expect(result.error.blockers.some((item) => item.code === 'REVIEW_INPUT_MISSING')).toBe(true);
      }
      expect(app.db.prepare('SELECT count(*) AS n FROM review_bundles WHERE project_id=? AND sr_id=?')
        .get(projectId, srId)).toEqual({ n: 0 });
      expect(app.db.prepare('SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?')
        .get(projectId, 'g1-empty-request')).toEqual({ n: 0 });
    } finally {
      await app.close();
    }
  });

  it('단계 전환의 후속 활동 저장 실패는 gate·단계·이력·receipt를 함께 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { srId, bundle } = await preparePassableG1(app);
      const before = {
        sr: app.db.prepare('SELECT progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?').get(projectId, srId),
        gate: app.db.prepare('SELECT validity,revision,last_pass_transition_id FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
          .get(projectId, srId, 'G1'),
        transitions: app.db.prepare('SELECT count(*) AS n FROM gate_transition_records WHERE project_id=? AND sr_id=?').get(projectId, srId),
      };
      app.db.exec(`CREATE TRIGGER reject_g1_pass_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='gate_passed' BEGIN SELECT RAISE(ABORT,'forced gate activity failure'); END`);
      const guard = srGuard(app.db, srId);
      const result = await app.invoke('M-028', {
        actorId: ownerId, projectId, srId, requestId: 'g1-transition-rollback', idempotencyKey: 'g1-transition-rollback',
        guard: { ...guard, expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, { toStage: 'planning', reason: 'rollback 원자성을 확인합니다.', gate: 'G1', bundleRef: bundle.bundleRef });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('STORE_UNAVAILABLE');
      expect(app.db.prepare('SELECT progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?').get(projectId, srId)).toEqual(before.sr);
      expect(app.db.prepare('SELECT validity,revision,last_pass_transition_id FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual(before.gate);
      expect(app.db.prepare('SELECT count(*) AS n FROM gate_transition_records WHERE project_id=? AND sr_id=?').get(projectId, srId)).toEqual(before.transitions);
      expect(app.db.prepare('SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?')
        .get(projectId, 'g1-transition-rollback')).toEqual({ n: 0 });
    } finally {
      await app.close();
    }
  });

  it('검토 요청과 승인의 후속 활동 저장 실패는 업무 결과와 receipt를 함께 rollback합니다', async () => {
    const requestApp = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(requestApp.db, 'PAY-102');
      await moveCurrentQuestionToG2(requestApp, srId);
      const before = {
        bundles: requestApp.db.prepare('SELECT count(*) AS n FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=?')
          .get(projectId, srId, 'G1'),
        gate: requestApp.db.prepare('SELECT * FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
          .get(projectId, srId, 'G1'),
      };
      requestApp.db.exec(`CREATE TRIGGER reject_review_request_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='review_requested' BEGIN SELECT RAISE(ABORT,'forced review request activity failure'); END`);
      const request = await requestApp.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'g1-request-rollback', idempotencyKey: 'g1-request-rollback',
        guard: gateGuard(requestApp.db, srId, 'G1'),
      }, currentReviewInput(requestApp, srId));
      expect(request).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(requestApp.db.prepare('SELECT count(*) AS n FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual(before.bundles);
      expect(requestApp.db.prepare('SELECT * FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual(before.gate);
      expect(requestApp.db.prepare('SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?')
        .get(projectId, 'g1-request-rollback')).toEqual({ n: 0 });
    } finally {
      await requestApp.close();
    }

    const approvalApp = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(approvalApp.db, 'PAY-102');
      const bundle = await currentG1(approvalApp, srId);
      const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
      if (checklist[0] === undefined) throw new Error('체크리스트가 비었습니다.');
      const beforeRequest = approvalApp.db.prepare(`SELECT status,revision,result_ref_json,handled_at FROM review_requests
        WHERE project_id=? AND sr_id=? AND gate=? AND reviewer_id=? AND status=?`).get(projectId, srId, 'G1', reviewerId, 'pending');
      approvalApp.db.exec(`CREATE TRIGGER reject_approval_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='review_approved' BEGIN SELECT RAISE(ABORT,'forced approval activity failure'); END`);
      const approval = await approvalApp.invoke('M-021', {
        actorId: reviewerId, projectId, srId, requestId: 'g1-approval-rollback', idempotencyKey: 'g1-approval-rollback',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, { bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1',
        checklistResults: [checklist[0], ...checklist.slice(1)] });
      expect(approval).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(approvalApp.db.prepare('SELECT count(*) AS n FROM approvals WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual({ n: 0 });
      expect(approvalApp.db.prepare(`SELECT status,revision,result_ref_json,handled_at FROM review_requests
        WHERE project_id=? AND sr_id=? AND gate=? AND reviewer_id=? AND status=?`).get(projectId, srId, 'G1', reviewerId, 'pending'))
        .toEqual(beforeRequest);
      expect(approvalApp.db.prepare('SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?')
        .get(projectId, 'g1-approval-rollback')).toEqual({ n: 0 });
    } finally {
      await approvalApp.close();
    }
  });

  it('종류만 있는 요구사항은 구조화된 섹션·요구사항·완료 기준으로 보지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      await moveCurrentQuestionToG2(app, srId);
      const before = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      if (!before.ok) throw new Error('요구사항 조회 실패');
      const requirements = before.value.artifacts.find((item) => item.kind === 'requirements');
      if (requirements === undefined) throw new Error('요구사항 문서가 없습니다.');
      const saved = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId, requestId: 'g1-empty-structure', idempotencyKey: 'g1-empty-structure',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: requirements.artifactId },
          expectedRevision: requirements.revision } },
      }, {
        kind: 'requirements', artifactId: requirements.artifactId,
        markdown: '# 요구사항\n\n문서 종류만 존재합니다.', sectionIndex: [], requirementLinks: [],
        changeSummary: '구조화된 필드를 제거합니다.', targetBasis: { kind: 'version', ref: requirements.versionRef },
        decisionRefs: [], sourceRefs: [], questionResultRefs: [],
      });
      if (!saved.ok) throw new Error(`요구사항 저장 실패: ${saved.error.code}`);
      const requestGuard = gateGuard(app.db, srId, 'G1');
      const bundle = await requestFreshG1(app, srId, 'g1-structure-request');
      const afterRequest = readGateState(app.db, { kind: 'sr', projectId, srId }, 'G1');
      expect(afterRequest?.revision).toBe(requestGuard.resource.expectedRevision + 1);
      const requestReceipt = app.db.prepare(
        'SELECT committed_revision FROM command_receipts WHERE project_id=? AND idempotency_key=?',
      ).get(projectId, 'g1-structure-request') as { readonly committed_revision: number };
      expect(requestReceipt.committed_revision).toBe(afterRequest?.revision);
      const staleRequest = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'g1-structure-stale-request', idempotencyKey: 'g1-structure-stale-request',
        guard: requestGuard,
      }, currentReviewInput(app, srId));
      expect(staleRequest).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } });
      const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
      if (checklist[0] === undefined) throw new Error('체크리스트가 비었습니다.');
      const approval = await app.invoke('M-021', {
        actorId: reviewerId, projectId, srId, requestId: 'g1-structure-approval', idempotencyKey: 'g1-structure-approval',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, { bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1',
        checklistResults: [checklist[0], ...checklist.slice(1)] });
      if (!approval.ok) throw new Error(`승인 실패: ${approval.error.code}`);
      const assessment = await app.invoke('M-027', { actorId: ownerId, projectId, srId }, 'G1');
      expect(assessment.ok).toBe(true);
      if (assessment.ok) {
        expect(assessment.value.conditions.find((item) => item.conditionId === 'GP-02')?.passed).toBe(false);
        expect(assessment.value.canTransition).toBe(false);
      }
    } finally {
      await app.close();
    }
  });

  it('문서 검토 모드는 미해결 질문을 참고로 보고 단순 요구사항 문서를 승인해 G1을 통과합니다', async () => {
    const app = await createTestApp({
      fixture: 'DEMO-4',
      testRunId: randomUUID(),
      documentReviewMode: true,
    });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const before = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      if (!before.ok) throw new Error('요구사항 조회 실패');
      const requirements = before.value.artifacts.find((item) => item.kind === 'requirements');
      if (requirements === undefined) throw new Error('요구사항 문서가 없습니다.');
      expect(before.value.questions.some((item) => item.status !== 'resolved' &&
        item.currentClassification.scope === 'current' && item.currentClassification.requiredGate === 'G1')).toBe(true);
      const saved = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId, requestId: 'document-review-save', idempotencyKey: 'document-review-save',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: requirements.artifactId },
          expectedRevision: requirements.revision } },
      }, {
        kind: 'requirements', artifactId: requirements.artifactId,
        markdown: '# Inception Plan\n\n사용자가 현재 문서 원문을 검토합니다.', sectionIndex: [], requirementLinks: [],
        changeSummary: '문서 원문을 검토할 버전으로 저장합니다.', targetBasis: { kind: 'version', ref: requirements.versionRef },
        decisionRefs: [], sourceRefs: [], questionResultRefs: [],
      });
      if (!saved.ok) throw new Error(`요구사항 저장 실패: ${saved.error.code}`);
      const bundle = await requestFreshG1(app, srId, 'document-review-request');
      const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
      if (checklist[0] === undefined) throw new Error('체크리스트가 비었습니다.');
      const approval = await app.invoke('M-021', {
        actorId: reviewerId, projectId, srId, requestId: 'document-review-approval', idempotencyKey: 'document-review-approval',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, {
        bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1',
        checklistResults: [checklist[0], ...checklist.slice(1)],
      });
      if (!approval.ok) throw new Error(`승인 실패: ${approval.error.code}`);

      const assessment = await app.invoke('M-027', { actorId: ownerId, projectId, srId }, 'G1');
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) return;
      expect(assessment.value.conditions.find((item) => item.conditionId === 'GP-02')).toMatchObject({ passed: true });
      expect(assessment.value.conditions.find((item) => item.conditionId === 'GP-03')).toMatchObject({
        passed: true,
        reason: expect.stringMatching(/미해결 질문 1개.*참고용 기록.*문서 검토와 분리/u),
      });
      expect(assessment.value.conditions.find((item) => item.conditionId === 'GP-04')).toMatchObject({
        passed: true,
        reason: expect.stringMatching(/미확정 결정 \d+개.*참고용 기록.*문서 검토와 분리/u),
      });
      expect(assessment.value.canTransition).toBe(true);

      const transition = await app.invoke('M-028', {
        actorId: ownerId, projectId, srId, requestId: 'document-review-pass', idempotencyKey: 'document-review-pass',
        guard: { ...srGuard(app.db, srId), expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, { toStage: 'planning', reason: '현재 문서 버전과 검토자 승인을 확인했습니다.', gate: 'G1', bundleRef: bundle.bundleRef });
      expect(transition.ok).toBe(true);
      if (transition.ok) expect(transition.value.progressStage).toBe('planning');
    } finally {
      await app.close();
    }
  });

  it('전환 질문은 연결 결정을 한 번만 검사하고 실제 결정권자를 GP-04 담당자로 반환합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      if (!detail.ok) throw new Error('질문 조회 실패');
      const question = detail.value.questions.find((item) => item.status === 'open' &&
        item.currentClassification.scope === 'current' && item.currentClassification.requiredGate === 'G1');
      if (question === undefined) throw new Error('전환할 질문이 없습니다.');
      const converted = await app.invoke('M-011', {
        actorId: ownerId, projectId, srId, requestId: 'g1-convert', idempotencyKey: 'g1-convert',
        guard: { resource: { target: { kind: 'question', projectId, srId, entityId: question.questionId },
          expectedRevision: question.revision } },
      }, {
        questionId: question.questionId, questionResultSnapshotRef: question.currentResult.ref,
        prompt: '부분 취소 예외를 어떤 정책으로 확정합니까?',
        alternatives: [
          { optionId: 'retry', label: '재시도', description: '같은 요청 key로 재시도합니다.' },
          { optionId: 'reject', label: '거절', description: '명확한 오류로 거절합니다.' },
        ],
        impact: '결제 취소의 예외 처리 기준에 영향을 줍니다.', decisionMakerId,
        classificationRef: question.classificationRef,
      });
      if (!converted.ok) throw new Error(`결정 전환 실패: ${converted.error.code}`);
      const bundle = await requestFreshG1(app, srId, 'g1-converted-request');
      const assessment = await app.invoke('M-027', { actorId: ownerId, projectId, srId }, 'G1');
      expect(assessment.ok).toBe(true);
      if (assessment.ok) {
        const gp03 = assessment.value.conditions.find((item) => item.conditionId === 'GP-03');
        const gp04 = assessment.value.conditions.find((item) => item.conditionId === 'GP-04');
        expect(gp03?.passed).toBe(true);
        expect(gp04).toMatchObject({ passed: false, assigneeIds: [decisionMakerId],
          targetRefs: [{ kind: 'decision', projectId, srId, entityId: converted.value.decisionId }] });
        expect(assessment.value.currentBundleRef).toEqual(bundle.bundleRef);
      }
    } finally {
      await app.close();
    }
  });

  it('현재 지정자가 아닌 멤버와 오래된 bundle 승인을 거절하며 같은 key 승인만 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const bundle = await currentG1(app, srId);
      const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
      if (checklist[0] === undefined) throw new Error('체크리스트가 비었습니다.');
      const input = { bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1' as const,
        checklistResults: [checklist[0], ...checklist.slice(1)] as const };
      const unassigned = await app.invoke('M-021', {
        actorId: ownerId, projectId, srId, requestId: 'g1-unassigned', idempotencyKey: 'g1-unassigned',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, input);
      expect(unassigned.ok).toBe(false);
      if (!unassigned.ok) expect(unassigned.error.code).toBe('NOT_ASSIGNED');

      const incomplete = await app.invoke('M-021', {
        actorId: reviewerId, projectId, srId, requestId: 'g1-incomplete-checklist', idempotencyKey: 'g1-incomplete-checklist',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, { ...input, checklistResults: [checklist[0]] });
      expect(incomplete).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

      const wrongEpoch = await app.invoke('M-021', {
        actorId: reviewerId, projectId, srId, requestId: 'g1-wrong-epoch', idempotencyKey: 'g1-wrong-epoch',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch + 1 },
      }, { ...input, reviewEpoch: bundle.reviewEpoch + 1 });
      expect(wrongEpoch).toMatchObject({ ok: false, error: { code: 'STALE_BUNDLE' } });

      const meta = { actorId: reviewerId, projectId, srId, requestId: 'g1-replay-approval', idempotencyKey: 'g1-replay-approval',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch } };
      const first = await app.invoke('M-021', meta, input);
      if (!first.ok) throw new Error(`승인 실패: ${first.error.code}`);
      const replay = await app.invoke('M-021', { ...meta, requestId: 'g1-replay-approval-retry' }, input);
      expect(replay).toMatchObject({ ok: true, disposition: 'Replayed', value: first.value });
      const duplicate = await app.invoke('M-021', {
        ...meta, requestId: 'g1-duplicate-approval', idempotencyKey: 'g1-duplicate-approval',
      }, input);
      expect(duplicate).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

      await moveCurrentQuestionToG2(app, srId);
      const afterBasisChange = {
        approvals: app.db.prepare('SELECT count(*) AS n FROM approvals WHERE project_id=? AND sr_id=?')
          .get(projectId, srId),
        activities: app.db.prepare("SELECT count(*) AS n FROM activity_events WHERE project_id=? AND sr_id=? AND event_type='review_approved'")
          .get(projectId, srId),
      };
      const replayAfterBasisChange = await app.invoke('M-021', {
        ...meta, requestId: 'g1-replay-after-basis-change',
      }, input);
      expect(replayAfterBasisChange).toMatchObject({
        ok: true, disposition: 'Replayed', value: first.value, receipt: first.receipt,
      });
      const conflictAfterBasisChange = await app.invoke('M-021', {
        ...meta, requestId: 'g1-conflict-after-basis-change',
      }, { ...input, comment: '같은 key의 다른 승인 입력입니다.' });
      expect(conflictAfterBasisChange).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
      expect({
        approvals: app.db.prepare('SELECT count(*) AS n FROM approvals WHERE project_id=? AND sr_id=?')
          .get(projectId, srId),
        activities: app.db.prepare("SELECT count(*) AS n FROM activity_events WHERE project_id=? AND sr_id=? AND event_type='review_approved'")
          .get(projectId, srId),
      }).toEqual(afterBasisChange);

      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.value.approvals).toContainEqual(first.value);
        expect(detail.value.reviewRequests.find((item) => item.reviewerId === reviewerId)).toMatchObject({
          status: 'handled', resultRef: { kind: 'approval', entityId: first.value.approvalId },
        });
        expect(detail.value.gateAssessments.map((item) => item.gate)).toEqual(['G1', 'G2']);
      }

      if (!detail.ok) return;
      const requirements = detail.value.artifacts.find((item) => item.kind === 'requirements');
      if (requirements === undefined) throw new Error('현재 요구사항 문서가 없습니다.');
      const edited = await app.invoke('M-015', {
        actorId: ownerId, projectId, srId, requestId: 'g1-basis-edit', idempotencyKey: 'g1-basis-edit',
        guard: { resource: { target: { kind: 'artifact', projectId, srId, entityId: requirements.artifactId },
          expectedRevision: requirements.revision } },
      }, {
        kind: 'requirements', artifactId: requirements.artifactId,
        markdown: `${requirements.markdown}\n`, sectionIndex: requirements.sectionIndex,
        requirementLinks: requirements.requirementLinks, changeSummary: '승인 뒤 기준 변경 재생을 검사합니다.',
        targetBasis: { kind: 'version', ref: requirements.versionRef }, decisionRefs: requirements.decisionRefs,
        sourceRefs: requirements.sourceRefs, questionResultRefs: requirements.questionResultRefs,
      });
      if (!edited.ok) throw new Error(`요구사항 변경 실패: ${edited.error.code}`);
      const replayAfterArtifactChange = await app.invoke('M-021', {
        ...meta, requestId: 'g1-replay-after-artifact-change',
      }, input);
      expect(replayAfterArtifactChange).toMatchObject({
        ok: true, disposition: 'Replayed', value: first.value, receipt: first.receipt,
      });

      const reassigned = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'g1-remove-reviewer', idempotencyKey: 'g1-remove-reviewer',
        guard: gateGuard(app.db, srId, 'G1'),
      }, { gate: 'G1', reviewerIds: [], previousAssignmentRef: bundle.assignmentRef,
        changeReason: '현재 검토자 배정을 제거합니다.' });
      if (!reassigned.ok) throw new Error(`배정 제거 실패: ${reassigned.error.code}`);
      const removedReplay = await app.invoke('M-021', { ...meta, requestId: 'g1-removed-replay' }, input);
      expect(removedReplay.ok).toBe(false);
      if (!removedReplay.ok) expect(removedReplay.error.code).toBe('NOT_ASSIGNED');
    } finally {
      await app.close();
    }
  });

  it('요청·평가·전환은 현재 멤버, owner, 정확한 gate와 SR guard를 각각 검사합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const bundle = await currentG1(app, srId);
      const requestInput = {
        gate: 'G1' as const, artifactVersionRefs: bundle.artifactVersionRefs,
        decisionVersionRefs: bundle.decisionVersionRefs, unconfirmedDecisionSnapshots: bundle.unconfirmedDecisionSnapshots,
        questionResultRefs: bundle.questionResultRefs, classificationRefs: bundle.classificationRefs,
        contextSourceVersionRefs: bundle.contextSourceVersionRefs, assignmentRef: bundle.assignmentRef,
        reviewerIds: bundle.reviewerIds, policyRef: bundle.policyRef,
      };
      const notOwner = await app.invoke('M-020', {
        actorId: reviewerId, projectId, srId, requestId: 'g1-request-not-owner', idempotencyKey: 'g1-request-not-owner',
        guard: gateGuard(app.db, srId, 'G1'),
      }, requestInput);
      expect(notOwner).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });
      const staleGate = gateGuard(app.db, srId, 'G1');
      staleGate.resource.expectedRevision -= 1;
      const staleRequest = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId, requestId: 'g1-request-stale', idempotencyKey: 'g1-request-stale',
        guard: staleGate,
      }, requestInput);
      expect(staleRequest).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } });

      const outsider = await app.invoke('M-027', { actorId: 'unknown-persona', projectId, srId }, 'G1');
      expect(outsider).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const transitionInput = { toStage: 'planning' as const, reason: '권한 경계를 검사합니다.',
        gate: 'G1' as const, bundleRef: bundle.bundleRef };
      const exactSr = srGuard(app.db, srId);
      const unauthorizedTransition = await app.invoke('M-028', {
        actorId: reviewerId, projectId, srId, requestId: 'g1-pass-not-owner', idempotencyKey: 'g1-pass-not-owner',
        guard: { ...exactSr, expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, transitionInput);
      expect(unauthorizedTransition).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });
      exactSr.resource.expectedRevision -= 1;
      const staleTransition = await app.invoke('M-028', {
        actorId: ownerId, projectId, srId, requestId: 'g1-pass-stale', idempotencyKey: 'g1-pass-stale',
        guard: { ...exactSr, expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, transitionInput);
      expect(staleTransition).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } });
    } finally {
      await app.close();
    }
  });

  it('검토자 집합의 저장 순서가 달라도 현재 공식 묶음 판정을 바꾸지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const previous = await currentG1(app, srId);
      const assigned = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'g1-order-assignment', idempotencyKey: 'g1-order-assignment',
        guard: gateGuard(app.db, srId, 'G1'),
      }, { gate: 'G1', reviewerIds: [reviewerId, ownerId], previousAssignmentRef: previous.assignmentRef,
        changeReason: '검토자 집합 순서와 현재성을 분리합니다.' });
      if (!assigned.ok) throw new Error(`배정 실패: ${assigned.error.code}`);
      const assessment = await app.invoke('M-027', { actorId: ownerId, projectId, srId }, 'G1');
      expect(assessment.ok).toBe(true);
      if (assessment.ok) {
        expect(assessment.value.conditions.find((item) => item.conditionId === 'GP-01')?.passed).toBe(true);
      }
    } finally {
      await app.close();
    }
  });

  it('M047은 승인 JSON 추가 필드를 노출하지 않고 필수 체크리스트 손상을 저장 오류로 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const bundle = await currentG1(app, srId);
      const checklist = bundle.checklistSnapshot.map((item) => ({ itemId: item.itemId, checked: true as const }));
      if (checklist[0] === undefined) throw new Error('체크리스트가 비었습니다.');
      const approval = await app.invoke('M-021', {
        actorId: reviewerId, projectId, srId, requestId: 'g1-codec-approval', idempotencyKey: 'g1-codec-approval',
        guard: { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch },
      }, { bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1',
        checklistResults: [checklist[0], ...checklist.slice(1)] });
      if (!approval.ok) throw new Error(`승인 실패: ${approval.error.code}`);
      app.db.exec('DROP TRIGGER approvals_no_update');
      app.db.prepare('UPDATE approvals SET checklist_results_json=? WHERE project_id=? AND sr_id=? AND approval_id=?')
        .run(JSON.stringify(checklist.map((item) => ({ ...item, rawEnvironment: 'CG18_CANARY' }))),
          projectId, srId, approval.value.approvalId);
      app.db.prepare('UPDATE review_requests SET result_ref_json=? WHERE project_id=? AND sr_id=? AND result_ref_json IS NOT NULL')
        .run(JSON.stringify({ kind: 'approval', projectId, srId, entityId: approval.value.approvalId,
          ownershipToken: 'CG18_CANARY' }), projectId, srId);
      const safe = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(safe.ok).toBe(true);
      expect(JSON.stringify(safe)).not.toContain('CG18_CANARY');

      app.db.prepare('UPDATE approvals SET checklist_results_json=? WHERE project_id=? AND sr_id=? AND approval_id=?')
        .run('[]', projectId, srId, approval.value.approvalId);
      const malformed = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(malformed).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });

      app.db.prepare('UPDATE approvals SET checklist_results_json=? WHERE project_id=? AND sr_id=? AND approval_id=?')
        .run(JSON.stringify(checklist), projectId, srId, approval.value.approvalId);
      app.db.exec('DROP TRIGGER review_policy_versions_no_update');
      app.db.prepare('UPDATE review_policy_versions SET gates_json=? WHERE project_id=? AND policy_id=? AND version=?')
        .run('{"G1":{},"G2":{}}', projectId, bundle.policyRef.entityId, bundle.policyRef.version);
      const malformedPolicy = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(malformedPolicy).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await app.close();
    }
  });
});
