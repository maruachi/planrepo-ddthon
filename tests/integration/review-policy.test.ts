import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import type { DatabaseConnection } from '@/src/persistence/database';
import { createTestApp } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const ownerId = manifest.personaIds['P-01'];
const memberId = manifest.personaIds['P-02'];
const reviewerId = manifest.personaIds['P-03'];
const adminId = manifest.personaIds['P-05'];

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

function srIdForKey(db: DatabaseConnection, key: string): string {
  const row = db.prepare('SELECT sr_id FROM srs WHERE project_id=? AND sr_key=?')
    .get(projectId, key) as { readonly sr_id: string } | undefined;
  if (row === undefined) throw new Error(`SR not found: ${key}`);
  return row.sr_id;
}

const policyEdit = {
  gates: {
    G1: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'new-g1', label: '새 G1 확인' }] },
    G2: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'new-g2', label: '새 G2 확인' }] },
  },
  requireAllAssigned: true as const,
  requireDistinctPeer: true as const,
} as const;

describe('review policy and assignment', () => {
  it('현재 멤버인 등록자와 담당자는 검토자를 배정하고 다른 일반 멤버는 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const registered = await app.invoke('M-003', {
        actorId: reviewerId, projectId, requestId: 'creator-assignment-sr', idempotencyKey: 'creator-assignment-sr',
      }, {
        key: 'TEST-CREATOR-ASSIGN', title: '등록자 검토자 선택', purpose: '등록자와 담당자 권한을 확인합니다.',
        description: '등록자는 담당자와 다릅니다.', ownerId,
      });
      if (!registered.ok) throw new Error(`SR 등록 실패: ${registered.error.code}`);
      const srId = registered.value.scope.srId;
      const creatorAssignment = await app.invoke('M-030', {
        actorId: reviewerId, projectId, srId, requestId: 'creator-assignment', idempotencyKey: 'creator-assignment',
        guard: gateGuard(app.db, srId, 'G1'),
      }, { gate: 'G1', reviewerIds: [reviewerId] });
      expect(creatorAssignment.ok).toBe(true);
      if (!creatorAssignment.ok) return;

      const denied = await app.invoke('M-030', {
        actorId: memberId, projectId, srId, requestId: 'member-assignment', idempotencyKey: 'member-assignment',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [reviewerId], previousAssignmentRef: creatorAssignment.value.assignmentRef,
        changeReason: '권한 없는 일반 멤버 요청입니다.',
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');

      const ownerAssignment = await app.invoke('M-030', {
        actorId: ownerId, projectId, srId, requestId: 'owner-assignment', idempotencyKey: 'owner-assignment',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [reviewerId], previousAssignmentRef: creatorAssignment.value.assignmentRef,
        changeReason: '현재 담당자가 배정을 확인합니다.',
      });
      expect(ownerAssignment.ok).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('M001과 M047은 기본 정책·정책 내용과 엄격한 bundle snapshot을 읽습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const workspace = await app.invoke('M-001', { actorId: ownerId, projectId }, {});
      expect(workspace.ok).toBe(true);
      if (!workspace.ok) return;
      expect(workspace.value.defaultPolicyRef).toEqual({
        kind: 'review_policy', projectId, entityId: manifest.policyId, version: 1,
      });
      expect(workspace.value.policies[0]?.gates.G1.checklist[0]?.itemId).toBe('g1-requirements');

      const srId = srIdForKey(app.db, 'PAY-102');
      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.value.bundles[0]).toMatchObject({
        assignmentRef: { kind: 'review_assignment', projectId, srId },
        descriptionRef: { kind: 'sr_description', projectId, srId },
        createdBy: ownerId,
        checklistSnapshot: expect.arrayContaining([{ itemId: 'g1-requirements', label: '요구사항과 완료 기준을 확인했습니다.' }]),
      });
    } finally {
      await app.close();
    }
  });

  it('문서 없는 SR에 최초 검토자를 배정해도 가짜 묶음을 만들지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const registered = await app.invoke('M-003', {
        actorId: ownerId,
        projectId,
        requestId: 'new-unprepared',
        idempotencyKey: 'new-unprepared',
      }, {
        key: 'TEST-ASSIGN-1',
        title: '최초 배정',
        purpose: '문서 전 배정을 검사합니다.',
        description: '아직 문서가 없습니다.',
        ownerId,
      });
      if (!registered.ok) throw new Error(`SR 등록 실패: ${registered.error.code}`);
      const srId = registered.value.scope.srId;
      const result = await app.invoke('M-030', {
        actorId: adminId,
        projectId,
        srId,
        requestId: 'assign-first',
        idempotencyKey: 'assign-first',
        guard: gateGuard(app.db, srId, 'G1'),
      }, { gate: 'G1', reviewerIds: [ownerId, reviewerId] });

      expect(result.ok).toBe(true);
      expect(app.db.prepare(
        'SELECT count(*) AS n FROM review_assignment_versions WHERE project_id=? AND sr_id=? AND gate=?',
      ).get(projectId, srId, 'G1')).toEqual({ n: 1 });
      expect(app.db.prepare(
        'SELECT count(*) AS n FROM review_bundles WHERE project_id=? AND sr_id=?',
      ).get(projectId, srId)).toEqual({ n: 0 });
    } finally {
      await app.close();
    }
  });

  it('M030은 비정렬 검토자와 최신 상태를 분리해 원 성공값을 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const registered = await app.invoke('M-003', {
        actorId: ownerId, projectId, requestId: 'replay-order-sr', idempotencyKey: 'replay-order-sr',
      }, {
        key: 'TEST-REPLAY-ORDER', title: '재생 순서', purpose: '영수증 불변성 검사',
        description: '비정렬 검토자 재생을 검사합니다.', ownerId,
      });
      if (!registered.ok) throw new Error('SR 등록 실패');
      const srId = registered.value.scope.srId;
      const firstGuard = gateGuard(app.db, srId, 'G1');
      const first = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'assign-order-first', idempotencyKey: 'assign-order',
        guard: firstGuard,
      }, { gate: 'G1', reviewerIds: [reviewerId, ownerId] });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const changed = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'assign-order-change', idempotencyKey: 'assign-order-change',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [reviewerId], previousAssignmentRef: first.value.assignmentRef,
        changeReason: '재생 후 현재 기준 분리를 검사합니다.',
      });
      expect(changed.ok).toBe(true);

      const replay = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'assign-order-retry', idempotencyKey: 'assign-order',
        guard: firstGuard,
      }, { gate: 'G1', reviewerIds: [reviewerId, ownerId] });
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      expect(replay.disposition).toBe('Replayed');
      expect(replay.value).toEqual(first.value);
      if (replay.current === undefined || first.receipt === undefined) throw new Error('재생 현재 기준과 원 영수증이 없습니다.');
      expect(replay.current.currentRevision).toBeGreaterThan(first.receipt.committedRevision);
    } finally {
      await app.close();
    }
  });

  it('새 기본 정책은 기존 SR에 소급하지 않고 이후 등록 SR에 고정합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const existingSrId = srIdForKey(app.db, 'PAY-102');
      const before = app.db.prepare(
        'SELECT gate,policy_id,policy_version FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, existingSrId);
      const created = await app.invoke('M-029', {
        actorId: adminId, projectId, requestId: 'policy-v2', idempotencyKey: 'policy-v2',
      }, {
        ...policyEdit,
        previousPolicyRef: {
          kind: 'review_policy', projectId, entityId: manifest.policyId, version: 1,
        },
        changeReason: '새 체크리스트를 적용합니다.',
      });
      expect(created.ok).toBe(true);
      expect(app.db.prepare(
        'SELECT gate,policy_id,policy_version FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, existingSrId)).toEqual(before);

      const registered = await app.invoke('M-003', {
        actorId: ownerId, projectId, requestId: 'new-policy-sr', idempotencyKey: 'new-policy-sr',
      }, {
        key: 'TEST-POLICY-2', title: '새 정책 SR', purpose: '비소급 검사',
        description: '새 기본 정책을 고정합니다.', ownerId,
      });
      if (!registered.ok || !created.ok) throw new Error('준비 명령 실패');
      expect(app.db.prepare(
        'SELECT gate,policy_id,policy_version FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, registered.value.scope.srId)).toEqual([
        { gate: 'G1', policy_id: created.value.policyRef.entityId, policy_version: created.value.policyRef.version },
        { gate: 'G2', policy_id: created.value.policyRef.entityId, policy_version: created.value.policyRef.version },
      ]);

      const applied = await app.invoke('M-031', {
        actorId: adminId, projectId, srId: existingSrId,
        requestId: 'policy-existing-g1', idempotencyKey: 'policy-existing-g1',
        guard: { resources: [gateGuard(app.db, existingSrId, 'G1').resource] },
      }, { policyRef: created.value.policyRef, gates: ['G1'] });
      expect(applied.ok).toBe(true);
      expect(app.db.prepare(
        'SELECT gate,policy_version FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, existingSrId)).toEqual([
        { gate: 'G1', policy_version: 2 },
        { gate: 'G2', policy_version: 1 },
      ]);
    } finally {
      await app.close();
    }
  });

  it('준비된 SR 배정은 현재 자료의 불변 묶음과 검토 요청을 만듭니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const previousRequests = app.db.prepare(
        'SELECT request_id,requested_by,requested_at FROM review_requests WHERE project_id=? AND sr_id=? AND gate=? AND status=? ORDER BY request_id',
      ).all(projectId, srId, 'G1', 'pending') as Array<{ request_id: string; requested_by: string; requested_at: string }>;
      const result = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'assign-ready', idempotencyKey: 'assign-ready',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [reviewerId],
        previousAssignmentRef: {
          kind: 'review_assignment', projectId, srId,
          entityId: `assignment-${srId.replace(/^sr-/, '')}-g1`, version: 1,
        },
        changeReason: '현재 기준으로 다시 배정합니다.',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.ready).toBe(true);
      const bundle = app.db.prepare(
        'SELECT payload_json,checklist_json FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=? ORDER BY rowid DESC LIMIT 1',
      ).get(projectId, srId, 'G1') as { payload_json: string; checklist_json: string };
      const payload = JSON.parse(bundle.payload_json) as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual([
        'artifactVersionRefs', 'assignmentRef', 'classificationRefs', 'contextSourceVersionRefs',
        'decisionVersionRefs', 'descriptionRef', 'policyRef', 'questionResultRefs',
        'reviewerIds', 'unconfirmedDecisionSnapshots',
      ].sort());
      expect(JSON.parse(bundle.checklist_json)).toEqual([
        { itemId: 'g1-requirements', label: '요구사항과 완료 기준을 확인했습니다.' },
        { itemId: 'g1-evidence', label: '질문·결정과 근거를 확인했습니다.' },
      ]);
      expect(app.db.prepare(
        'SELECT count(*) AS n FROM review_requests WHERE project_id=? AND sr_id=? AND gate=? AND status=?',
      ).get(projectId, srId, 'G1', 'pending')).toEqual({ n: 1 });
      for (const old of previousRequests) {
        expect(app.db.prepare(
          'SELECT requested_by,requested_at,status,superseded_by_request_id FROM review_requests WHERE project_id=? AND sr_id=? AND request_id=?',
        ).get(projectId, srId, old.request_id)).toMatchObject({
          requested_by: old.requested_by,
          requested_at: old.requested_at,
          status: 'superseded',
          superseded_by_request_id: expect.any(String),
        });
      }

      app.db.prepare('UPDATE demo_user_memberships SET roles_json=? WHERE project_id=? AND user_id=?')
        .run(JSON.stringify(['reviewer']), projectId, adminId);
      const replayWithoutCurrentRole = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'assign-ready-retry', idempotencyKey: 'assign-ready',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [reviewerId],
        previousAssignmentRef: {
          kind: 'review_assignment', projectId, srId,
          entityId: `assignment-${srId.replace(/^sr-/, '')}-g1`, version: 1,
        },
        changeReason: '현재 기준으로 다시 배정합니다.',
      });
      expect(replayWithoutCurrentRole.ok).toBe(false);
      if (!replayWithoutCurrentRole.ok) expect(replayWithoutCurrentRole.error.code).toBe('FORBIDDEN');
    } finally {
      await app.close();
    }
  });

  it('문서 검토 모드에서 M030 배정은 새 검토본과 검토 요청을 자동 생성하지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID(), documentReviewMode: true });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const before = app.db.prepare(
        `SELECT
           (SELECT count(*) FROM review_bundles WHERE project_id=? AND sr_id=? AND gate='G1') AS bundles,
           (SELECT count(*) FROM review_requests WHERE project_id=? AND sr_id=? AND gate='G1') AS requests`,
      ).get(projectId, srId, projectId, srId) as { readonly bundles: number; readonly requests: number };
      const priorState = app.db.prepare(
        `SELECT review_epoch,assignment_id,assignment_version
           FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate='G1'`,
      ).get(projectId, srId) as { readonly review_epoch: number; readonly assignment_id: string; readonly assignment_version: number };

      const assigned = await app.invoke('M-030', {
        actorId: ownerId, projectId, srId,
        requestId: 'document-mode-assign', idempotencyKey: 'document-mode-assign',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [reviewerId],
        previousAssignmentRef: {
          kind: 'review_assignment', projectId, srId,
          entityId: priorState.assignment_id, version: priorState.assignment_version,
        },
        changeReason: '문서 리뷰어를 명시적으로 선택합니다.',
      });
      expect(assigned.ok).toBe(true);
      if (!assigned.ok) return;
      expect(assigned.value.ready).toBe(true);

      const after = app.db.prepare(
        `SELECT
           (SELECT count(*) FROM review_bundles WHERE project_id=? AND sr_id=? AND gate='G1') AS bundles,
           (SELECT count(*) FROM review_requests WHERE project_id=? AND sr_id=? AND gate='G1') AS requests`,
      ).get(projectId, srId, projectId, srId) as { readonly bundles: number; readonly requests: number };
      expect(after).toEqual(before);
      expect(app.db.prepare(
        `SELECT count(*) AS n FROM review_requests
          WHERE project_id=? AND sr_id=? AND gate='G1' AND review_epoch>?`,
      ).get(projectId, srId, priorState.review_epoch)).toEqual({ n: 0 });
      const afterState = app.db.prepare(
        `SELECT revision,review_epoch,needs_new_bundle
           FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate='G1'`,
      ).get(projectId, srId) as { readonly revision: number; readonly review_epoch: number; readonly needs_new_bundle: number };
      expect(afterState.review_epoch).toBeGreaterThan(priorState.review_epoch);
      expect(afterState.needs_new_bundle).toBe(1);

      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      const preparation = detail.value.reviewPreparations.find((item) => item.gate === 'G1');
      if (preparation?.kind !== 'Ready') throw new Error('명시적 검토 요청 입력이 준비되지 않았습니다.');
      const requested = await app.invoke('M-020', {
        actorId: ownerId, projectId, srId,
        requestId: 'document-mode-review', idempotencyKey: 'document-mode-review',
        guard: gateGuard(app.db, srId, 'G1'),
      }, preparation.input);
      expect(requested.ok).toBe(true);
      if (requested.ok) expect(requested.value.kind).toBe('BundleAvailable');
      expect(app.db.prepare(
        `SELECT
           (SELECT count(*) FROM review_bundles WHERE project_id=? AND sr_id=? AND gate='G1') AS bundles,
           (SELECT count(*) FROM review_requests WHERE project_id=? AND sr_id=? AND gate='G1') AS requests`,
      ).get(projectId, srId, projectId, srId)).toEqual({ bundles: before.bundles + 1, requests: before.requests + 1 });
    } finally {
      await app.close();
    }
  });

  it('후속 활동 저장 실패는 배정·gate·receipt를 모두 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const beforeState = app.db.prepare('SELECT * FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1');
      const beforeAssignments = app.db.prepare('SELECT count(*) AS n FROM review_assignment_versions WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1');
      app.db.exec(`CREATE TRIGGER reject_reviewers_assigned BEFORE INSERT ON activity_events
        WHEN NEW.event_type='reviewers_assigned' BEGIN SELECT RAISE(ABORT,'forced review activity failure'); END`);
      const result = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'assign-rollback', idempotencyKey: 'assign-rollback',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [reviewerId],
        previousAssignmentRef: {
          kind: 'review_assignment', projectId, srId,
          entityId: `assignment-${srId.replace(/^sr-/, '')}-g1`, version: 1,
        },
        changeReason: 'rollback을 검사합니다.',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('STORE_UNAVAILABLE');
      expect(app.db.prepare('SELECT * FROM review_gate_states WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual(beforeState);
      expect(app.db.prepare('SELECT count(*) AS n FROM review_assignment_versions WHERE project_id=? AND sr_id=? AND gate=?')
        .get(projectId, srId, 'G1')).toEqual(beforeAssignments);
      expect(app.db.prepare('SELECT count(*) AS n FROM command_receipts WHERE project_id=? AND idempotency_key=?')
        .get(projectId, 'assign-rollback')).toEqual({ n: 0 });
    } finally {
      await app.close();
    }
  });

  it('M047은 bundle JSON의 존재하지 않는 version ref를 안전한 저장 오류로 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      app.db.exec('DROP TRIGGER review_bundles_no_update');
      const row = app.db.prepare('SELECT rowid,payload_json FROM review_bundles WHERE project_id=? AND sr_id=? LIMIT 1')
        .get(projectId, srId) as { rowid: number; payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      payload.contextSourceVersionRefs = [{ kind: 'context_source', projectId, srId, entityId: 'missing', version: 1 }];
      app.db.prepare('UPDATE review_bundles SET payload_json=? WHERE rowid=?').run(JSON.stringify(payload), row.rowid);
      const detail = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(detail.ok).toBe(false);
      if (!detail.ok) expect(detail.error.code).toBe('STORE_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });

  it('M047 bundle은 ref 추가 필드를 노출하지 않고 분류 대상 관계 손상을 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      app.db.exec('DROP TRIGGER review_bundles_no_update');
      const row = app.db.prepare('SELECT rowid,payload_json FROM review_bundles WHERE project_id=? AND sr_id=? LIMIT 1')
        .get(projectId, srId) as { rowid: number; payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const artifacts = payload.artifactVersionRefs as Array<Record<string, unknown>>;
      payload.artifactVersionRefs = [{ ...artifacts[0], ownershipToken: 'CG17_CANARY' }, ...artifacts.slice(1)];
      payload.assignmentRef = { ...(payload.assignmentRef as Record<string, unknown>), ownershipToken: 'CG17_CANARY' };
      app.db.prepare('UPDATE review_bundles SET payload_json=? WHERE rowid=?').run(JSON.stringify(payload), row.rowid);

      const safe = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(safe.ok).toBe(true);
      expect(JSON.stringify(safe.ok ? safe.value.bundles : null)).not.toContain('CG17_CANARY');

      const decision = app.db.prepare(`SELECT decision_id,revision,prompt,alternatives_json,impact,decision_maker_id
        FROM decisions WHERE project_id=? AND sr_id=? LIMIT 1`).get(projectId, srId) as {
          decision_id: string; revision: number; prompt: string; alternatives_json: string;
          impact: string; decision_maker_id: string;
        };
      const questionClassification = app.db.prepare(`SELECT classification_id,version
        FROM scope_classification_versions WHERE project_id=? AND sr_id=? AND target_kind='question' LIMIT 1`)
        .get(projectId, srId) as { classification_id: string; version: number };
      const wrongClassificationRef = {
        kind: 'scope_classification', projectId, srId,
        entityId: questionClassification.classification_id, version: questionClassification.version,
      };
      payload.decisionVersionRefs = (payload.decisionVersionRefs as Array<Record<string, unknown>>)
        .filter((ref) => ref.entityId !== decision.decision_id);
      payload.classificationRefs = [
        ...(payload.classificationRefs as Array<Record<string, unknown>>),
        wrongClassificationRef,
      ];
      payload.unconfirmedDecisionSnapshots = [{
        decisionId: decision.decision_id,
        revision: decision.revision,
        prompt: decision.prompt,
        alternatives: JSON.parse(decision.alternatives_json),
        impact: decision.impact,
        decisionMakerId: decision.decision_maker_id,
        classificationRef: wrongClassificationRef,
      }];
      app.db.prepare('UPDATE review_bundles SET payload_json=? WHERE rowid=?').run(JSON.stringify(payload), row.rowid);
      const corrupt = await app.invoke('M-047', { actorId: ownerId, projectId, srId }, {});
      expect(corrupt.ok).toBe(false);
      if (!corrupt.ok) expect(corrupt.error.code).toBe('STORE_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });

  it('빈 배정은 저장하지만 준비됨이나 묶음으로 가장하지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'PAY-102');
      const result = await app.invoke('M-030', {
        actorId: adminId, projectId, srId, requestId: 'assign-empty', idempotencyKey: 'assign-empty',
        guard: gateGuard(app.db, srId, 'G1'),
      }, {
        gate: 'G1', reviewerIds: [],
        previousAssignmentRef: {
          kind: 'review_assignment', projectId, srId,
          entityId: `assignment-${srId.replace(/^sr-/, '')}-g1`, version: 1,
        },
        changeReason: '검토자 배정을 비웁니다.',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.ready).toBe(false);
      expect(result.value.notReadyReason).toContain('한 명 이상');
      expect(app.db.prepare(
        'SELECT count(*) AS n FROM review_bundles WHERE project_id=? AND sr_id=? AND gate=? AND review_epoch>1',
      ).get(projectId, srId, 'G1')).toEqual({ n: 0 });
    } finally {
      await app.close();
    }
  });

  it('M031은 선택 gate별 guard를 정확히 한 번 요구하고 원자적으로 적용합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const before = app.db.prepare(
        'SELECT gate,revision,review_epoch,policy_version FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, srId);
      const historicalApprovals = app.db.prepare('SELECT * FROM approvals WHERE project_id=? AND sr_id=? ORDER BY approval_id')
        .all(projectId, srId);
      const openChanges = app.db.prepare("SELECT * FROM change_requests WHERE project_id=? AND sr_id=? AND status IN ('open','awaiting_confirmation') ORDER BY change_request_id")
        .all(projectId, srId);
      const rejected = await app.invoke('M-031', {
        actorId: adminId, projectId, srId, requestId: 'policy-both-bad', idempotencyKey: 'policy-both-bad',
        guard: { resources: [gateGuard(app.db, srId, 'G1').resource] },
      }, {
        policyRef: { kind: 'review_policy', projectId, entityId: manifest.policyId, version: 1 },
        gates: ['G1', 'G2'],
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.error.code).toBe('STALE_VERSION');
      expect(app.db.prepare(
        'SELECT gate,revision,review_epoch,policy_version FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, srId)).toEqual(before);

      const policy = await app.invoke('M-029', {
        actorId: adminId, projectId, requestId: 'policy-for-both', idempotencyKey: 'policy-for-both',
      }, {
        ...policyEdit,
        previousPolicyRef: { kind: 'review_policy', projectId, entityId: manifest.policyId, version: 1 },
        changeReason: '두 gate 동시 적용을 검사합니다.',
      });
      if (!policy.ok) throw new Error('정책 생성 실패');
      const applicationGuard = {
        resources: [gateGuard(app.db, srId, 'G1').resource, gateGuard(app.db, srId, 'G2').resource],
      };
      const applied = await app.invoke('M-031', {
        actorId: adminId, projectId, srId, requestId: 'policy-both', idempotencyKey: 'policy-both',
        guard: applicationGuard,
      }, { policyRef: policy.value.policyRef, gates: ['G1', 'G2'] });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.gates.map(({ gate, result }) => [gate, result.kind])).toEqual([
        ['G1', 'BundleAvailable'], ['G2', 'NeedsInputs'],
      ]);
      const after = app.db.prepare(
        'SELECT gate,revision,review_epoch,policy_version FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(projectId, srId) as Array<{ gate: string; revision: number; review_epoch: number; policy_version: number }>;
      expect(after.map((row, index) => ({
        gate: row.gate,
        revisionDelta: row.revision - (before[index] as { revision: number }).revision,
        epochDelta: row.review_epoch - (before[index] as { review_epoch: number }).review_epoch,
        policyVersion: row.policy_version,
      }))).toEqual([
        { gate: 'G1', revisionDelta: 1, epochDelta: 1, policyVersion: 2 },
        { gate: 'G2', revisionDelta: 1, epochDelta: 1, policyVersion: 2 },
      ]);
      expect(app.db.prepare('SELECT * FROM approvals WHERE project_id=? AND sr_id=? ORDER BY approval_id')
        .all(projectId, srId)).toEqual(historicalApprovals);
      expect(app.db.prepare("SELECT * FROM change_requests WHERE project_id=? AND sr_id=? AND status IN ('open','awaiting_confirmation') ORDER BY change_request_id")
        .all(projectId, srId)).toEqual(openChanges);

      const receiptRow = app.db.prepare(
        'SELECT receipt_id,replay_value_json FROM command_receipts WHERE project_id=? AND idempotency_key=?',
      ).get(projectId, 'policy-both') as { receipt_id: string; replay_value_json: string };
      const corrupted = JSON.parse(receiptRow.replay_value_json) as Record<string, unknown>;
      corrupted.ownershipToken = 'must-not-leak';
      ((corrupted.gates as Array<{ result: Record<string, unknown> }>)[1]?.result as Record<string, unknown>).rawEnvironment = 'must-not-leak';
      app.db.exec('DROP TRIGGER command_receipts_no_update');
      app.db.prepare('UPDATE command_receipts SET replay_value_json=? WHERE project_id=? AND receipt_id=?')
        .run(JSON.stringify(corrupted), projectId, receiptRow.receipt_id);
      const replay = await app.invoke('M-031', {
        actorId: adminId, projectId, srId, requestId: 'policy-both-retry', idempotencyKey: 'policy-both',
        guard: applicationGuard,
      }, { policyRef: policy.value.policyRef, gates: ['G1', 'G2'] });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.disposition).toBe('Replayed');
      expect(JSON.stringify(replay.ok ? replay.value : null)).not.toContain('must-not-leak');
    } finally {
      await app.close();
    }
  });

  it('M031은 비정렬 gate와 requestIds의 원 영수증 값을 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = srIdForKey(app.db, 'AUTH-331');
      const policy = await app.invoke('M-029', {
        actorId: adminId, projectId, requestId: 'policy-replay-order', idempotencyKey: 'policy-replay-order',
      }, {
        ...policyEdit,
        previousPolicyRef: { kind: 'review_policy', projectId, entityId: manifest.policyId, version: 1 },
        changeReason: '재생 순서를 검사합니다.',
      });
      if (!policy.ok) throw new Error('정책 생성 실패');
      const applicationGuard = {
        resources: [gateGuard(app.db, srId, 'G2').resource, gateGuard(app.db, srId, 'G1').resource],
      };
      const input = { policyRef: policy.value.policyRef, gates: ['G2', 'G1'] as const };
      const first = await app.invoke('M-031', {
        actorId: adminId, projectId, srId, requestId: 'policy-replay-order-apply', idempotencyKey: 'policy-replay-order-apply',
        guard: applicationGuard,
      }, input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const replay = await app.invoke('M-031', {
        actorId: adminId, projectId, srId, requestId: 'policy-replay-order-retry', idempotencyKey: 'policy-replay-order-apply',
        guard: applicationGuard,
      }, input);
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      expect(replay.disposition).toBe('Replayed');
      expect(replay.value).toEqual(first.value);
    } finally {
      await app.close();
    }
  });
});
