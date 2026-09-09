import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import { createGenerationFixture } from '@/tests/helpers/generation-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

describe('공개 생성 HTTP 계약', () => {
  it('M-032~M-035를 실제 handler로 연결하고 취소 알림 실패와 현재 조회를 분리합니다', async () => {
    const notified: string[] = [];
    const app = await createTestApp({
      fixture: 'empty',
      testRunId: randomUUID(),
      cancellationNotifications: {
        async notifyCancellation(_scope, runId) {
          notified.push(runId);
          throw new Error('post-commit notification failed');
        },
      },
    });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke(
        'M-032',
        { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'public-request' },
        fixture.input,
      );
      expect(requested).toMatchObject({ ok: true, value: { status: 'pending' } });
      if (!requested.ok) return;
      expect(await app.invoke('M-033', fixture.scope, requested.value.runId)).toEqual({
        ok: true,
        value: requested.value,
        disposition: 'Query',
      });

      const cancelled = await app.invoke(
        'M-034',
        { ...fixture.scope, idempotencyKey: 'public-cancel' },
        requested.value.runId,
      );
      expect(cancelled).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(notified).toEqual([requested.value.runId]);

      const retried = await app.invoke(
        'M-035',
        { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'public-retry' },
        requested.value.runId,
      );
      expect(retried).toMatchObject({ ok: true, value: { status: 'pending' } });
      if (retried.ok) {
        expect(retried.value.runId).not.toBe(requested.value.runId);
      }
      expect(await app.invoke('M-033', fixture.scope, requested.value.runId)).toMatchObject({
        ok: true,
        value: { status: 'cancelled' },
      });
    } finally {
      await app.close();
    }
  });

  it('권한·scope·포화 오류를 정제하고 내부 실행 메서드를 공개하지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const userSelectedProvider = await app.server.inject({
        method: 'POST',
        url: '/api/methods/M-032',
        headers: {
          host: new URL(app.baseURL).host,
          origin: app.baseURL,
          'x-planrepo-actor': fixture.scope.actorId,
        },
        payload: {
          scope: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId },
          input: {
            ...fixture.input,
            providerSelection: { providerId: 'user-selected', modelChoice: { kind: 'installed_default' } },
          },
          meta: {
            requestId: randomUUID(), idempotencyKey: 'user-provider-selection', guard: fixture.guard,
          },
        },
      });
      expect(userSelectedProvider.statusCode).toBe(400);
      expect(await app.invoke(
        'M-032',
        {
          ...fixture.scope,
          actorId: manifest.personaIds['P-05'],
          guard: fixture.guard,
          idempotencyKey: 'not-owner',
        },
        fixture.input,
      )).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });

      const readable = await app.invoke(
        'M-032',
        { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'member-readable-run' },
        fixture.input,
      );
      if (!readable.ok) throw new Error(readable.error.code);
      expect(await app.invoke('M-033', {
        ...fixture.scope,
        actorId: manifest.personaIds['P-05'],
      }, readable.value.runId)).toMatchObject({
        ok: true,
        value: { runId: readable.value.runId, status: 'pending' },
      });
      expect(await app.invoke('M-033', {
        ...fixture.scope,
        actorId: 'not-a-project-member',
      }, readable.value.runId)).toMatchObject({
        ok: false, error: { code: 'FORBIDDEN' },
      });
      expect(await app.invoke('M-034', {
        ...fixture.scope,
        actorId: manifest.personaIds['P-05'],
        idempotencyKey: 'member-cannot-cancel',
      }, readable.value.runId)).toMatchObject({
        ok: false, error: { code: 'NOT_ASSIGNED' },
      });

      let runId = readable.value.runId;
      for (let index = 1; index < 10; index += 1) {
        const result = await app.invoke(
          'M-032',
          { ...fixture.scope, guard: fixture.guard, idempotencyKey: `public-capacity-${index}` },
          fixture.input,
        );
        if (!result.ok) throw new Error(result.error.code);
        runId = result.value.runId;
      }
      const queueResponse = await app.server.inject({
        method: 'POST',
        url: '/api/methods/M-032',
        headers: {
          host: new URL(app.baseURL).host,
          origin: app.baseURL,
          'x-planrepo-actor': fixture.scope.actorId,
        },
        payload: {
          scope: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId },
          input: fixture.input,
          meta: {
            requestId: randomUUID(),
            idempotencyKey: 'public-capacity-overflow',
            guard: fixture.guard,
          },
        },
      });
      expect(queueResponse.statusCode).toBe(409);
      expect(queueResponse.json()).toMatchObject({ error: { code: 'QUEUE_FULL' } });

      const second = await app.invoke('M-003', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        idempotencyKey: 'other-sr',
      }, {
        key: 'GEN-OTHER', title: '다른 SR', purpose: 'scope 검증',
        description: '다른 SR 설명', ownerId: fixture.scope.actorId,
      });
      if (!second.ok) throw new Error(second.error.code);
      expect(await app.invoke('M-033', {
        actorId: fixture.scope.actorId,
        projectId: fixture.scope.projectId,
        srId: second.value.scope.srId,
      }, runId)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

      for (const methodId of ['M-036', 'M-037', 'M-038', 'M-039', 'M-049', 'M-050']) {
        const response = await app.server.inject({
          method: 'POST',
          url: `/api/methods/${methodId}`,
          headers: { host: new URL(app.baseURL).host, origin: app.baseURL },
          payload: {},
        });
        expect(response.statusCode).toBe(404);
      }
    } finally {
      await app.close();
    }
  });

  it('M-033과 M-047은 저장된 정제 execution report의 실제 모델 정보만 표시합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke(
        'M-032',
        { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'execution-report' },
        fixture.input,
      );
      if (!requested.ok) throw new Error(requested.error.code);
      expect(requested.value).not.toHaveProperty('actualModelId');
      expect(requested.value).not.toHaveProperty('cliVersion');
      app.db.prepare(
        `UPDATE generation_runs
            SET status='failed',revision=2,error_code='PROVIDER_ERROR',
                finished_at='2026-09-09T02:01:00.000Z',payload_json=?
          WHERE project_id=? AND sr_id=? AND run_id=?`,
      ).run(JSON.stringify({
        execution: {
          providerId: 'claude-cli',
          actualModelId: 'claude-opus-4-8-20260901',
          cliVersion: '2.3.4',
          profileVersion: 'claude-profile-v1',
          startedAt: '2026-09-09T02:00:10.000Z',
          finishedAt: '2026-09-09T02:01:00.000Z',
          exitCode: 1,
          stdoutBytes: 120,
          stderrBytes: 40,
          stdoutClosed: true,
          stderrClosed: true,
          ownershipToken: 'virtual-secret-canary',
          rawEnvironment: { VIRTUAL_SECRET: 'virtual-secret-canary' },
          diagnostic: 'raw provider diagnostic',
        },
      }), fixture.scope.projectId, fixture.scope.srId, requested.value.runId);

      const status = await app.invoke('M-033', fixture.scope, requested.value.runId);
      expect(status).toMatchObject({
        ok: true,
        value: {
          actualModelId: 'claude-opus-4-8-20260901',
          cliVersion: '2.3.4',
          requestedSelection: requested.value.requestedSelection,
        },
      });
      if (!status.ok) throw new Error(status.error.code);
      expect(status.value).not.toHaveProperty('ownershipToken');
      expect(status.value).not.toHaveProperty('rawEnvironment');
      expect(status.value).not.toHaveProperty('diagnostic');

      const detail = await app.invoke('M-047', fixture.scope, {});
      if (!detail.ok) throw new Error(detail.error.code);
      expect(detail.value.generationRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: requested.value.runId,
          actualModelId: 'claude-opus-4-8-20260901',
          cliVersion: '2.3.4',
          requestedSelection: requested.value.requestedSelection,
        }),
      ]));
      app.db.prepare(
        `UPDATE generation_runs SET payload_json=?
          WHERE project_id=? AND sr_id=? AND run_id=?`,
      ).run(
        JSON.stringify({ execution: { providerId: 'claude-cli' } }),
        fixture.scope.projectId, fixture.scope.srId, requested.value.runId,
      );
      expect(await app.invoke('M-033', fixture.scope, requested.value.runId)).toMatchObject({
        ok: false, error: { code: 'STORE_UNAVAILABLE' },
      });
    } finally {
      await app.close();
    }
  });

  it('저장된 receipt replay와 provider selection 손상을 STORE_UNAVAILABLE 503으로 정제합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const key = 'stored-codec-run';
      const requested = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: key }, fixture.input,
      );
      if (!requested.ok) throw new Error(requested.error.code);
      const headers = {
        host: new URL(app.baseURL).host,
        origin: app.baseURL,
        'x-planrepo-actor': fixture.scope.actorId,
      };
      app.db.exec('DROP TRIGGER command_receipts_no_update');
      app.db.prepare(
        'UPDATE command_receipts SET replay_value_json=? WHERE project_id=? AND receipt_id=?',
      ).run(JSON.stringify({
        ...requested.value,
        scope: { ...requested.value.scope, ownershipToken: 'nested-scope-canary' },
        requestedSelection: {
          ...requested.value.requestedSelection,
          rawEnvironment: { VIRTUAL_SECRET: 'nested-selection-canary' },
          modelChoice: {
            ...requested.value.requestedSelection.modelChoice,
            ownershipToken: 'nested-model-canary',
          },
        },
        application: { kind: 'not_applied', rawEnvironment: 'nested-application-canary' },
        actualModelId: 'resolved-model',
        cliVersion: '1.2.3',
        ownershipToken: 'virtual-secret-canary',
        rawEnvironment: { VIRTUAL_SECRET: 'virtual-secret-canary' },
      }), fixture.scope.projectId, requested.receipt?.receiptId);
      const safeReplay = await app.server.inject({
        method: 'POST',
        url: '/api/methods/M-032',
        headers,
        payload: {
          scope: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId },
          input: fixture.input,
          meta: { requestId: randomUUID(), idempotencyKey: key, guard: fixture.guard },
        },
      });
      expect(safeReplay.statusCode).toBe(200);
      expect(safeReplay.json()).toMatchObject({
        kind: 'Replayed',
        value: { actualModelId: 'resolved-model', cliVersion: '1.2.3' },
      });
      expect(safeReplay.json().value).not.toHaveProperty('ownershipToken');
      expect(safeReplay.json().value).not.toHaveProperty('rawEnvironment');
      expect(safeReplay.json().value.scope).not.toHaveProperty('ownershipToken');
      expect(safeReplay.json().value.requestedSelection).not.toHaveProperty('rawEnvironment');
      expect(safeReplay.json().value.requestedSelection.modelChoice).not.toHaveProperty('ownershipToken');
      expect(safeReplay.json().value.application).not.toHaveProperty('rawEnvironment');

      app.db.prepare(
        'UPDATE command_receipts SET replay_value_json=? WHERE project_id=? AND receipt_id=?',
      ).run('{}', fixture.scope.projectId, requested.receipt?.receiptId);
      const corruptReceipt = await app.server.inject({
        method: 'POST',
        url: '/api/methods/M-032',
        headers,
        payload: {
          scope: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId },
          input: fixture.input,
          meta: { requestId: randomUUID(), idempotencyKey: key, guard: fixture.guard },
        },
      });
      expect(corruptReceipt.statusCode).toBe(503);
      expect(corruptReceipt.json()).toMatchObject({ error: { code: 'STORE_UNAVAILABLE' } });

      app.db.prepare(
        'UPDATE generation_runs SET provider_selection_json=? WHERE project_id=? AND sr_id=? AND run_id=?',
      ).run('{}', fixture.scope.projectId, fixture.scope.srId, requested.value.runId);
      const corruptSelection = await app.server.inject({
        method: 'POST',
        url: '/api/methods/M-033',
        headers,
        payload: {
          scope: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId },
          input: requested.value.runId,
        },
      });
      expect(corruptSelection.statusCode).toBe(503);
      expect(corruptSelection.json()).toMatchObject({ error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await app.close();
    }
  });
});
