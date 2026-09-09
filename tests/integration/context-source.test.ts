import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ContextSourceView } from '@/src/contracts/views';
import { demoCase } from '@/tests/helpers/domain-cases';
import { createTestApp, type TestApp } from '@/tests/helpers/test-app';

function srGuard(projectId: string, srId: string, revision: number) {
  return {
    resource: {
      target: { kind: 'sr' as const, projectId, srId, entityId: srId },
      expectedRevision: revision,
    },
  };
}

function sourceGuard(source: ContextSourceView) {
  return {
    resource: {
      target: {
        kind: 'context_source' as const,
        projectId: source.scope.projectId,
        srId: source.scope.srId,
        entityId: source.sourceId,
      },
      expectedRevision: source.revision,
    },
  };
}

async function detail(app: TestApp, key: Parameters<typeof demoCase>[0]) {
  const sample = demoCase(key);
  const result = await app.invoke('M-047', {
    actorId: sample.ownerId,
    projectId: sample.projectId,
    srId: sample.srId,
  }, {});
  if (!result.ok) throw new Error(`${key} 상세 조회에 실패했습니다.`);
  return result.value;
}

describe('근거 자료 공개 메서드', () => {
  it('현재 멤버가 링크를 미확인으로 등록하고 담당자가 새 불변 version으로 확인합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('NOTI-028');
      const before = await detail(app, 'NOTI-028');
      const oldHandoffs = app.db.prepare(
        'SELECT count(*) AS count FROM handoffs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId);
      const attached = await app.invoke('M-006', {
        actorId: sample.personaIds['P-02'],
        projectId: sample.projectId,
        srId: sample.srId,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      }, {
        kind: 'link',
        targetUrl: 'https://example.invalid/reference',
        provenance: '사용자가 추가한 가상 근거입니다.',
        verifiable: false,
        displayName: '외부 정책 원문',
        observedExternalVersion: 'demo-v1',
        unavailableReason: '외부 통신을 사용하지 않는 데모입니다.',
      });
      expect(attached.ok).toBe(true);
      if (!attached.ok) return;
      expect(attached.value).toMatchObject({
        kind: 'link', confirmation: 'unconfirmed',
        targetUrl: 'https://example.invalid/reference',
        provenance: '사용자가 추가한 가상 근거입니다.',
        verifiable: false, displayName: '외부 정책 원문',
        observedExternalVersion: 'demo-v1',
        unavailableReason: '외부 통신을 사용하지 않는 데모입니다.',
        createdBy: sample.personaIds['P-02'],
        currentVersionRef: { version: 1 }, revision: 1,
        reviewImpact: {
          affectedGates: ['G1', 'G2'], needsNewReview: true,
          returnStage: 'requirements', currentHandoffValid: false,
        },
      });
      expect(attached.value.confirmedBy).toBeUndefined();
      expect(attached.receipt).toMatchObject({
        commandKind: 'M-006',
        committedRevision: 1,
        resultRefs: [
          {
            kind: 'context_source', projectId: sample.projectId,
            srId: sample.srId, entityId: attached.value.sourceId,
          },
          attached.value.currentVersionRef,
        ],
      });

      const afterAttach = await detail(app, 'NOTI-028');
      expect(afterAttach.sr).toMatchObject({
        progressStage: 'requirements', revision: before.sr.revision + 1,
        gates: [
          { gate: 'G1', reviewEpoch: before.sr.gates[0]!.reviewEpoch + 1, validity: 'invalid' },
          { gate: 'G2', reviewEpoch: before.sr.gates[1]!.reviewEpoch + 1, validity: 'invalid' },
        ],
      });
      expect(afterAttach.sources).toEqual([
        expect.objectContaining({
          sourceId: attached.value.sourceId,
          targetUrl: 'https://example.invalid/reference',
          provenance: '사용자가 추가한 가상 근거입니다.',
          confirmation: 'unconfirmed',
        }),
      ]);

      const confirmed = await app.invoke('M-007', {
        actorId: sample.ownerId,
        projectId: sample.projectId,
        srId: sample.srId,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        guard: sourceGuard(attached.value),
      }, {
        sourceVersionRef: attached.value.currentVersionRef,
        confirmationEvidence: '담당자가 원문을 직접 확인했습니다.',
      });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) return;
      expect(confirmed.value).toMatchObject({
        sourceId: attached.value.sourceId,
        currentVersionRef: { version: 2 },
        previousVersionRef: attached.value.currentVersionRef,
        revision: 2, kind: 'link', confirmation: 'confirmed',
        confirmedBy: sample.ownerId,
        confirmationEvidence: '담당자가 원문을 직접 확인했습니다.',
      });
      expect(confirmed.value.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(confirmed.receipt).toMatchObject({
        commandKind: 'M-007',
        committedRevision: 2,
        resultRefs: [
          {
            kind: 'context_source', projectId: sample.projectId,
            srId: sample.srId, entityId: attached.value.sourceId,
          },
          confirmed.value.currentVersionRef,
        ],
      });
      expect(app.db.prepare(
        `SELECT version,confirmation,confirmed_by,target_url
           FROM context_source_versions
          WHERE project_id=? AND sr_id=? AND source_id=? ORDER BY version`,
      ).all(sample.projectId, sample.srId, attached.value.sourceId)).toEqual([
        { version: 1, confirmation: 'unconfirmed', confirmed_by: null, target_url: 'https://example.invalid/reference' },
        { version: 2, confirmation: 'confirmed', confirmed_by: sample.ownerId, target_url: 'https://example.invalid/reference' },
      ]);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM handoffs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId)).toEqual(oldHandoffs);
      const afterConfirm = await detail(app, 'NOTI-028');
      expect(afterConfirm.sr).toMatchObject({
        revision: before.sr.revision + 2,
        gates: [
          { gate: 'G1', reviewEpoch: before.sr.gates[0]!.reviewEpoch + 2, validity: 'invalid' },
          { gate: 'G2', reviewEpoch: before.sr.gates[1]!.reviewEpoch + 2, validity: 'invalid' },
        ],
      });
      expect(afterConfirm.sources).toMatchObject([
        {
          sourceId: attached.value.sourceId,
          currentVersionRef: { version: 2 },
          confirmation: 'confirmed',
          confirmedBy: sample.ownerId,
          confirmationEvidence: '담당자가 원문을 직접 확인했습니다.',
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it('본문 원문을 M-047에 보존하고 같은 등록 명령만 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const before = await detail(app, 'PAY-102');
      const idempotencyKey = randomUUID();
      const input = {
        kind: 'markdown' as const,
        content: '\n  # 결제 근거  \n본문\n',
        provenance: '  사용자 원문  ',
      };
      const command = {
        actorId: sample.personaIds['P-02'], projectId: sample.projectId, srId: sample.srId,
        idempotencyKey, guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      };
      const first = await app.invoke('M-006', { ...command, requestId: randomUUID() }, input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const replay = await app.invoke('M-006', { ...command, requestId: randomUUID() }, input);
      expect(replay).toMatchObject({ ok: true, disposition: 'Replayed', value: first.value });
      const conflict = await app.invoke('M-006', {
        ...command, requestId: randomUUID(),
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision + 1),
      }, input);
      expect(conflict).toMatchObject({
        ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' },
        priorReceipt: { receiptId: first.receipt?.receiptId },
      });
      const current = await detail(app, 'PAY-102');
      expect(current.sources).toEqual([
        expect.objectContaining({
          sourceId: first.value.sourceId, content: input.content,
          provenance: input.provenance, confirmation: 'unconfirmed',
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('M-006은 허용되지 않은 link URL을 VALIDATION_ERROR로 거절하고 업무 자료를 쓰지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const before = await detail(app, 'PAY-102');
      const result = await app.invoke('M-006', {
        actorId: sample.ownerId,
        projectId: sample.projectId,
        srId: sample.srId,
        idempotencyKey: 'invalid-link-url',
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      }, {
        kind: 'link',
        targetUrl: 'not a URL',
        provenance: '사용자 입력',
        verifiable: false,
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM context_sources WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId)).toEqual({ count: 0 });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM command_receipts WHERE project_id=? AND idempotency_key=?',
      ).get(sample.projectId, 'invalid-link-url')).toEqual({ count: 0 });
      expect((await detail(app, 'PAY-102')).sr.revision).toBe(before.sr.revision);
      const uppercaseScheme = await app.invoke('M-006', {
        actorId: sample.ownerId,
        projectId: sample.projectId,
        srId: sample.srId,
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      }, {
        kind: 'link',
        targetUrl: 'HTTPS://example.invalid/reference',
        provenance: '사용자 입력',
        verifiable: false,
      });
      expect(uppercaseScheme).toMatchObject({
        ok: true,
        value: { targetUrl: 'HTTPS://example.invalid/reference' },
      });
    } finally {
      await app.close();
    }
  });

  it('확인은 실제 담당자와 같은 SR의 현재 source version guard를 요구합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const other = demoCase('AUTH-331');
      const before = await detail(app, 'PAY-102');
      const forbidden = await app.invoke('M-006', {
        actorId: 'not-a-project-member', projectId: sample.projectId, srId: sample.srId,
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      }, { kind: 'text', content: '거절', provenance: '거절' });
      expect(forbidden).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const attached = await app.invoke('M-006', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      }, { kind: 'text', content: '정확한 본문', provenance: '사용자 입력' });
      if (!attached.ok) throw new Error('자료 등록에 실패했습니다.');
      const input = {
        sourceVersionRef: attached.value.currentVersionRef,
        confirmationEvidence: '직접 확인했습니다.',
      };
      const nonOwner = await app.invoke('M-007', {
        actorId: sample.personaIds['P-02'], projectId: sample.projectId, srId: sample.srId,
        guard: sourceGuard(attached.value),
      }, input);
      expect(nonOwner).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });
      const wrongScope = await app.invoke('M-007', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        guard: { resource: { target: {
          kind: 'context_source', projectId: sample.projectId,
          srId: other.srId, entityId: attached.value.sourceId,
        }, expectedRevision: attached.value.revision } },
      }, input);
      expect(wrongScope).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });

  it('등록 activity 실패는 source·gate·SR revision·receipt를 함께 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const before = await detail(app, 'PAY-102');
      const gateRows = app.db.prepare(
        'SELECT gate,review_epoch,validity,revision FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(sample.projectId, sample.srId);
      app.db.exec(
        `CREATE TEMP TRIGGER fail_source_activity BEFORE INSERT ON activity_events
         BEGIN SELECT RAISE(ABORT, '주입한 source 활동 실패'); END`,
      );
      const result = await app.invoke('M-006', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        idempotencyKey: 'rollback-source',
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      }, { kind: 'text', content: 'rollback', provenance: 'rollback' });
      expect(result).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM context_sources WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId)).toEqual({ count: 0 });
      expect(app.db.prepare(
        'SELECT revision,progress_stage FROM srs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId)).toEqual({
        revision: before.sr.revision, progress_stage: before.sr.progressStage,
      });
      expect(app.db.prepare(
        'SELECT gate,review_epoch,validity,revision FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(sample.projectId, sample.srId)).toEqual(gateRows);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM command_receipts WHERE project_id=? AND idempotency_key=?',
      ).get(sample.projectId, 'rollback-source')).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('확인 실패는 v1과 gate를 보존하고 같은 확인 명령만 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const before = await detail(app, 'PAY-102');
      const attached = await app.invoke('M-006', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        guard: srGuard(sample.projectId, sample.srId, before.sr.revision),
      }, { kind: 'text', content: '확인할 본문', provenance: '사용자 입력' });
      if (!attached.ok) throw new Error('자료 등록에 실패했습니다.');
      const gatesAfterAttach = app.db.prepare(
        'SELECT gate,review_epoch,validity,revision FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(sample.projectId, sample.srId);
      const srAfterAttach = app.db.prepare(
        'SELECT revision,progress_stage FROM srs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId);
      app.db.exec(
        `CREATE TEMP TRIGGER fail_confirm_activity BEFORE INSERT ON activity_events
         BEGIN SELECT RAISE(ABORT, '주입한 확인 활동 실패'); END`,
      );
      const input = {
        sourceVersionRef: attached.value.currentVersionRef,
        confirmationEvidence: '담당자가 직접 확인했습니다.',
      };
      const failed = await app.invoke('M-007', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        idempotencyKey: 'confirm-source', guard: sourceGuard(attached.value),
      }, input);
      expect(failed).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      expect(app.db.prepare(
        'SELECT current_version,revision FROM context_sources WHERE project_id=? AND sr_id=? AND source_id=?',
      ).get(sample.projectId, sample.srId, attached.value.sourceId)).toEqual({
        current_version: 1, revision: 1,
      });
      expect(app.db.prepare(
        'SELECT gate,review_epoch,validity,revision FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(sample.projectId, sample.srId)).toEqual(gatesAfterAttach);
      expect(app.db.prepare(
        'SELECT revision,progress_stage FROM srs WHERE project_id=? AND sr_id=?',
      ).get(sample.projectId, sample.srId)).toEqual(srAfterAttach);
      app.db.exec('DROP TRIGGER fail_confirm_activity');

      const command = {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        idempotencyKey: 'confirm-source', guard: sourceGuard(attached.value),
      };
      const committed = await app.invoke('M-007', { ...command, requestId: randomUUID() }, input);
      expect(committed).toMatchObject({ ok: true, disposition: 'Committed' });
      const replay = await app.invoke('M-007', { ...command, requestId: randomUUID() }, input);
      expect(replay).toMatchObject({
        ok: true,
        disposition: 'Replayed',
        current: {
          target: {
            kind: 'context_source', projectId: sample.projectId,
            srId: sample.srId, entityId: attached.value.sourceId,
          },
          currentRevision: 2,
        },
      });
      const conflict = await app.invoke('M-007', {
        ...command, requestId: randomUUID(),
        guard: { resource: { ...sourceGuard(attached.value).resource, expectedRevision: 2 } },
      }, input);
      expect(conflict).toMatchObject({
        ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' },
        priorReceipt: { receiptId: committed.ok ? committed.receipt?.receiptId : undefined },
      });
    } finally {
      await app.close();
    }
  });

  it('저장된 source codec 손상은 M-047과 M-007에서 STORE_UNAVAILABLE입니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const sourceId = `source-${randomUUID()}`;
      const now = '2026-09-09T00:00:00.000Z';
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO context_sources(
             project_id,sr_id,source_id,current_version,revision,created_by,created_at,display_name
           ) VALUES (?,?,?,1,1,?,?,NULL)`,
        ).run(sample.projectId, sample.srId, sourceId, sample.ownerId, now);
        app.db.prepare(
          `INSERT INTO context_source_versions(
             project_id,sr_id,source_id,version,kind,provenance,confirmation,
             created_by,created_at,content,target_url,confirmed_by,confirmed_at,
             confirmation_evidence,previous_version,payload_json
           ) VALUES (?,?,?,1,'link','손상 fixture','unconfirmed',?,?,NULL,?,NULL,NULL,NULL,NULL,'{}')`,
        ).run(
          sample.projectId, sample.srId, sourceId, sample.ownerId, now,
          'https://example.invalid/corrupt',
        );
      }).immediate();
      const queried = await app.invoke('M-047', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
      }, {});
      expect(queried).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      const confirmed = await app.invoke('M-007', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        guard: { resource: { target: {
          kind: 'context_source', projectId: sample.projectId,
          srId: sample.srId, entityId: sourceId,
        }, expectedRevision: 1 } },
      }, {
        sourceVersionRef: {
          kind: 'context_source', projectId: sample.projectId,
          srId: sample.srId, entityId: sourceId, version: 1,
        },
        confirmationEvidence: '확인 시도',
      });
      expect(confirmed).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await app.close();
    }
  });

  it('저장된 link URL이 정책을 위반하면 M-047과 M-007에서 STORE_UNAVAILABLE입니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const sample = demoCase('PAY-102');
      const sourceId = `source-${randomUUID()}`;
      const now = '2026-09-09T00:00:00.000Z';
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO context_sources(
             project_id,sr_id,source_id,current_version,revision,created_by,created_at,display_name
           ) VALUES (?,?,?,1,1,?,?,NULL)`,
        ).run(sample.projectId, sample.srId, sourceId, sample.ownerId, now);
        app.db.prepare(
          `INSERT INTO context_source_versions(
             project_id,sr_id,source_id,version,kind,provenance,confirmation,
             created_by,created_at,content,target_url,confirmed_by,confirmed_at,
             confirmation_evidence,previous_version,payload_json
           ) VALUES (?,?,?,1,'link','손상 fixture','unconfirmed',?,?,NULL,?,NULL,NULL,NULL,NULL,?)`,
        ).run(
          sample.projectId, sample.srId, sourceId, sample.ownerId, now,
          'javascript:alert(1)', JSON.stringify({ verifiable: false }),
        );
      }).immediate();
      const queried = await app.invoke('M-047', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
      }, {});
      expect(queried).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
      const confirmed = await app.invoke('M-007', {
        actorId: sample.ownerId, projectId: sample.projectId, srId: sample.srId,
        guard: { resource: { target: {
          kind: 'context_source', projectId: sample.projectId,
          srId: sample.srId, entityId: sourceId,
        }, expectedRevision: 1 } },
      }, {
        sourceVersionRef: {
          kind: 'context_source', projectId: sample.projectId,
          srId: sample.srId, entityId: sourceId, version: 1,
        },
        confirmationEvidence: '확인 시도',
      });
      expect(confirmed).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await app.close();
    }
  });
});
