import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import { createCurrentInputFingerprintPort } from '@/src/application/generation-preparation';
import { createGenerationService } from '@/src/application/generation-service';
import type { FingerprintGuard, NoGuard, SrScope } from '@/src/contracts/context';
import { createPersistence } from '@/src/persistence/transaction';
import { loadRuntimeConfig } from '@/src/runtime/config';
import { loadProjectRuleSource } from '@/src/runtime/project-rule-source';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

describe('생성 접수와 대기열', () => {
  it('replays a queued request at capacity and rejects only the eleventh new request', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { scope, input, guard } = await createGenerationFixture(app);
      const sent: string[] = [];
      for (let index = 0; index < 10; index += 1) {
        const result = await app.invoke(
          'M-032',
          { ...scope, guard, idempotencyKey: `queue-${index}` },
          input,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        expect(result.value.status).toBe('pending');
        sent.push(result.value.runId);
      }
      const replay = await app.invoke(
        'M-032', { ...scope, guard, idempotencyKey: 'queue-0' }, input,
      );
      expect(replay).toMatchObject({
        ok: true,
        disposition: 'Replayed',
        value: { runId: sent[0] },
      });
      const overflow = await app.invoke(
        'M-032', { ...scope, guard, idempotencyKey: 'queue-10' }, input,
      );
      expect(overflow).toMatchObject({ ok: false, error: { code: 'QUEUE_FULL' } });
      expect(readGenerationState(app.db).nonterminalCount).toBe(10);
      expect(readGenerationState(app.db).snapshots).toHaveLength(10);
      expect(await app.invoke('M-033', scope, sent[9] ?? '')).toMatchObject({
        ok: true, value: { status: 'pending' },
      });
      expect(await app.invoke(
        'M-034', { ...scope, idempotencyKey: 'cancel-at-capacity' }, sent[9] ?? '',
      )).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(readGenerationState(app.db)).toMatchObject({ nonterminalCount: 9 });
    } finally {
      await app.close();
    }
  });

  it('고정 selection과 현재 입력을 저장하고 조회는 상태를 쓰지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const rules = loadProjectRuleSource(process.cwd()).rules;
      const config = loadRuntimeConfig(process.cwd(), {
        PLANREPO_MODE: 'test', PLANREPO_TEST_RUN_ID: randomUUID(),
      });
      const service = createGenerationService({
        persistence: createPersistence(app.db),
        projectRules: rules,
        selection: {
          providerId: config.generation.providerId,
          modelChoice: config.generation.modelChoice,
        },
        maxNonterminal: config.generation.maxNonterminal,
        providerInputBytes: config.limits.providerInputBytes,
        currentInputFingerprints: createCurrentInputFingerprintPort(rules),
        now: () => '2026-09-09T02:00:00.000Z',
      });
      const ctx = command(fixture.scope, fixture.guard, 'selection-fixed');
      const requested = service.requestGeneration(ctx, fixture.input);
      expect(requested).toMatchObject({
        kind: 'Committed',
        value: {
          status: 'pending',
          freshness: 'current',
          requestedSelection: {
            providerId: 'claude-cli',
            modelChoice: { kind: 'explicit', modelId: 'global.anthropic.claude-opus-4-8' },
          },
        },
      });
      if (requested.kind !== 'Committed') return;
      const before = readGenerationState(app.db, requested.value.runId);
      const queried = service.getGeneration(query(fixture.scope), requested.value.runId);
      expect(queried).toEqual(requested.value);
      expect(readGenerationState(app.db, requested.value.runId)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it('취소를 첫 terminal로 확정하고 알림 실패와 재시도에서 과거 실행을 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const notified: string[] = [];
      const service = serviceFor(app, {
        notifyCancellation(_scope, runId) {
          notified.push(runId);
          throw new Error('notification unavailable');
        },
      });
      const requested = service.requestGeneration(
        command(fixture.scope, fixture.guard, 'cancel-source'), fixture.input,
      );
      expect(requested.kind).toBe('Committed');
      if (requested.kind !== 'Committed') return;
      expect(service.cancelGeneration(
        command(fixture.scope, { kind: 'none' }, 'cancel-source'), requested.value.runId,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'IDEMPOTENCY_CONFLICT' } });
      const cancelContext = command(fixture.scope, { kind: 'none' }, 'cancel-once');
      const cancelled = service.cancelGeneration(cancelContext, requested.value.runId);
      expect(cancelled).toMatchObject({ kind: 'Committed', value: { status: 'cancelled', termination: 'unobserved' } });
      expect(notified).toEqual([requested.value.runId]);
      expect(service.cancelGeneration(
        { ...cancelContext, requestId: randomUUID() }, requested.value.runId,
      )).toMatchObject({ kind: 'Replayed', value: { status: 'cancelled' } });
      expect(notified).toHaveLength(1);
      expect(service.cancelGeneration(
        command(fixture.scope, { kind: 'none' }, 'cancel-terminal'), requested.value.runId,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'RUN_FINAL' } });

      const retried = service.retryGeneration(
        command(fixture.scope, fixture.guard, 'retry-current'), requested.value.runId,
      );
      expect(retried).toMatchObject({ kind: 'Committed', value: { status: 'pending' } });
      if (retried.kind !== 'Committed') return;
      expect(readGenerationState(app.db).runs).toEqual(expect.arrayContaining([
        expect.objectContaining({ runId: requested.value.runId, status: 'cancelled' }),
        expect.objectContaining({ runId: retried.value.runId, status: 'pending', retryOfRunId: requested.value.runId }),
      ]));
    } finally {
      await app.close();
    }
  });

  it('receipt를 현재 guard와 용량 검사보다 먼저 재생하고 다른 guard는 충돌로 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const service = serviceFor(app);
      const ctx = command(fixture.scope, fixture.guard, 'replay-before-current');
      const first = service.requestGeneration(ctx, fixture.input);
      expect(first.kind).toBe('Committed');
      if (first.kind !== 'Committed') return;
      const detail = await app.invoke('M-047', fixture.scope, {});
      if (!detail.ok) throw new Error(detail.error.code);
      const changed = await app.invoke('M-005', {
        ...fixture.scope,
        idempotencyKey: 'change-generation-basis',
        guard: {
          resource: {
            target: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId, entityId: fixture.scope.srId },
            expectedRevision: detail.value.sr.revision,
          },
        },
      }, {
        title: detail.value.sr.title,
        purpose: detail.value.currentDescription.purpose,
        description: `${detail.value.currentDescription.description}\n입력 변경`,
        changeReason: '생성 기준 변경',
      });
      expect(changed.ok).toBe(true);
      const replayed = service.requestGeneration({ ...ctx, requestId: randomUUID() }, fixture.input);
      expect(replayed).toMatchObject({
        kind: 'Replayed', value: { runId: first.value.runId },
        current: { target: { kind: 'generation_run', entityId: first.value.runId } },
      });
      if (replayed.kind === 'Replayed') {
        expect(replayed.current.inputFingerprint).not.toBe(fixture.guard.expectedInputFingerprint);
      }
      app.db.prepare('UPDATE srs SET owner_id=? WHERE project_id=? AND sr_id=?').run(
        manifest.personaIds['P-05'], fixture.scope.projectId, fixture.scope.srId,
      );
      expect(service.requestGeneration({ ...ctx, requestId: randomUUID() }, fixture.input)).toMatchObject({
        kind: 'Rejected', error: { code: 'NOT_ASSIGNED' },
      });
      app.db.prepare('UPDATE srs SET owner_id=? WHERE project_id=? AND sr_id=?').run(
        fixture.scope.actorId, fixture.scope.projectId, fixture.scope.srId,
      );
      expect(service.requestGeneration(
        command(fixture.scope, { expectedInputFingerprint: 'sha256:different' }, 'replay-before-current'),
        fixture.input,
      )).toMatchObject({
        kind: 'Rejected', error: { code: 'IDEMPOTENCY_CONFLICT' }, priorReceipt: first.receipt,
      });
      expect(service.requestGeneration(
        command(fixture.scope, fixture.guard, 'stale-new-command'), fixture.input,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'INPUT_CHANGED' } });
      expect(readGenerationState(app.db).runs).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('최종 ProviderRequest 크기와 늦은 activity 실패를 모두 rollback합니다', async () => {
    const sizeApp = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(sizeApp);
      const tooSmall = serviceFor(sizeApp, undefined, { providerInputBytes: 1 });
      expect(tooSmall.requestGeneration(
        command(fixture.scope, fixture.guard, 'provider-size'), fixture.input,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'VALIDATION_ERROR' } });
      expect(readGenerationState(sizeApp.db)).toMatchObject({ nonterminalCount: 0, snapshots: [], receipts: [] });
    } finally {
      await sizeApp.close();
    }

    const activityApp = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(activityApp);
      const before = readGenerationState(activityApp.db).businessDigest;
      activityApp.db.exec(`CREATE TRIGGER fail_generation_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='generation_requested' BEGIN SELECT RAISE(ABORT, 'late activity failure'); END`);
      expect(serviceFor(activityApp).requestGeneration(
        command(fixture.scope, fixture.guard, 'activity-failure'), fixture.input,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'STORE_UNAVAILABLE' } });
      expect(readGenerationState(activityApp.db)).toMatchObject({
        nonterminalCount: 0, snapshots: [], receipts: [], businessDigest: before,
      });
    } finally {
      await activityApp.close();
    }

    const receiptApp = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(receiptApp);
      receiptApp.db.exec(`CREATE TRIGGER fail_generation_receipt BEFORE INSERT ON command_receipts
        WHEN NEW.command_kind='M-032' BEGIN SELECT RAISE(ABORT, 'receipt failure'); END`);
      expect(serviceFor(receiptApp).requestGeneration(
        command(fixture.scope, fixture.guard, 'receipt-failure'), fixture.input,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'STORE_UNAVAILABLE' } });
      expect(readGenerationState(receiptApp.db)).toMatchObject({
        nonterminalCount: 0, snapshots: [], receipts: [],
      });
    } finally {
      await receiptApp.close();
    }
  });

  it('InputSnapshot은 허용되지만 실제 2 MiB ProviderRequest가 넘으면 아무 생성 자료도 남기지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      for (let index = 0; index < 2; index += 1) {
        const detail = await app.invoke('M-047', fixture.scope, {});
        if (!detail.ok) throw new Error(detail.error.code);
        const attached = await app.invoke('M-006', {
          ...fixture.scope,
          idempotencyKey: `provider-envelope-source-${index}`,
          guard: {
            resource: {
              target: {
                kind: 'sr', projectId: fixture.scope.projectId,
                srId: fixture.scope.srId, entityId: fixture.scope.srId,
              },
              expectedRevision: detail.value.sr.revision,
            },
          },
        }, {
          kind: 'text',
          content: 'a'.repeat(1_046_150),
          provenance: `ProviderRequest 경계 자료 ${index}`,
        });
        if (!attached.ok) throw new Error(attached.error.code);
      }
      const prepared = await app.invoke(
        'M-047', fixture.scope, { kind: 'new_generation', input: fixture.input },
      );
      if (!prepared.ok || prepared.value.preparation?.kind !== 'new_generation') {
        throw new Error('2 MiB 경계 입력 준비 실패');
      }
      const beforeDigest = readGenerationState(app.db).businessDigest;
      const result = await app.invoke('M-032', {
        ...fixture.scope,
        idempotencyKey: 'provider-envelope-over-limit',
        guard: { expectedInputFingerprint: prepared.value.preparation.expectedInputFingerprint },
      }, fixture.input);
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: '최종 provider 요청은 UTF-8 2097152 bytes를 넘을 수 없습니다.',
        },
      });
      expect(readGenerationState(app.db)).toMatchObject({
        nonterminalCount: 0,
        runs: [],
        snapshots: [],
        receipts: [],
        businessDigest: beforeDigest,
      });
    } finally {
      await app.close();
    }
  });

  it('재시도는 바뀐 현재 입력 guard를 요구하고 이전 selection과 terminal 실행을 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const originalService = serviceFor(app);
      const requested = originalService.requestGeneration(
        command(fixture.scope, fixture.guard, 'retry-basis-source'), fixture.input,
      );
      if (requested.kind !== 'Committed') throw new Error('원 생성 접수 실패');
      const cancelled = originalService.cancelGeneration(
        command(fixture.scope, { kind: 'none' }, 'retry-basis-cancel'), requested.value.runId,
      );
      expect(cancelled.kind).toBe('Committed');

      const detail = await app.invoke('M-047', fixture.scope, {});
      if (!detail.ok) throw new Error(detail.error.code);
      const edited = await app.invoke('M-005', {
        ...fixture.scope,
        idempotencyKey: 'retry-basis-change',
        guard: {
          resource: {
            target: { kind: 'sr', projectId: fixture.scope.projectId, srId: fixture.scope.srId, entityId: fixture.scope.srId },
            expectedRevision: detail.value.sr.revision,
          },
        },
      }, {
        title: detail.value.sr.title,
        purpose: detail.value.currentDescription.purpose,
        description: `${detail.value.currentDescription.description}\n답변 반영`,
        changeReason: '재시도 현재 입력 변경',
      });
      expect(edited.ok).toBe(true);
      expect(originalService.retryGeneration(
        command(fixture.scope, fixture.guard, 'retry-stale-guard'), requested.value.runId,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'INPUT_CHANGED' } });

      const prepared = await app.invoke(
        'M-047', fixture.scope, { kind: 'retry', runId: requested.value.runId },
      );
      if (!prepared.ok || prepared.value.preparation?.kind !== 'retry') {
        throw new Error('현재 재시도 입력 준비 실패');
      }
      const changedSelectionService = serviceFor(app, undefined, {
        selection: { providerId: 'test', modelChoice: { kind: 'installed_default' } },
      });
      const retried = changedSelectionService.retryGeneration(
        command(
          fixture.scope,
          { expectedInputFingerprint: prepared.value.preparation.expectedInputFingerprint },
          'retry-current-guard',
        ),
        requested.value.runId,
      );
      expect(retried).toMatchObject({
        kind: 'Committed',
        value: {
          status: 'pending',
          requestedSelection: { providerId: 'test', modelChoice: { kind: 'installed_default' } },
        },
      });
      const runs = readGenerationState(app.db).runs;
      expect(runs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: requested.value.runId,
          status: 'cancelled',
          providerSelection: {
            providerId: 'claude-cli',
            modelChoice: { kind: 'explicit', modelId: 'global.anthropic.claude-opus-4-8' },
          },
        }),
        expect.objectContaining({
          status: 'pending', retryOfRunId: requested.value.runId,
          providerSelection: { providerId: 'test', modelChoice: { kind: 'installed_default' } },
        }),
      ]));
    } finally {
      await app.close();
    }
  });

  it('failed만 재시도하고 succeeded는 새 M-032 경로를 요구합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const service = serviceFor(app);
      const failed = service.requestGeneration(
        command(fixture.scope, fixture.guard, 'failed-source'), fixture.input,
      );
      if (failed.kind !== 'Committed') throw new Error('failed fixture 접수 실패');
      app.db.prepare(
        `UPDATE generation_runs SET status='failed',revision=2,error_code='PROVIDER_ERROR',
                finished_at='2026-09-09T02:01:00.000Z'
          WHERE project_id=? AND sr_id=? AND run_id=?`,
      ).run(fixture.scope.projectId, fixture.scope.srId, failed.value.runId);
      expect(service.retryGeneration(
        command(fixture.scope, fixture.guard, 'retry-failed'), failed.value.runId,
      )).toMatchObject({ kind: 'Committed', value: { status: 'pending' } });

      const succeeded = service.requestGeneration(
        command(fixture.scope, fixture.guard, 'succeeded-source'), fixture.input,
      );
      if (succeeded.kind !== 'Committed') throw new Error('succeeded fixture 접수 실패');
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO generation_drafts(
             project_id,sr_id,draft_id,schema_version,task_kind,body_json,
             basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,
             source_run_id,payload_json
           ) SELECT r.project_id,r.sr_id,?,1,r.task_kind,?,r.input_snapshot_id,s.content_fingerprint,?,?,r.run_id,'{}'
               FROM generation_runs r JOIN input_snapshots s
                 ON s.project_id=r.project_id AND s.sr_id=r.sr_id AND s.snapshot_id=r.input_snapshot_id
              WHERE r.project_id=? AND r.sr_id=? AND r.run_id=?`,
        ).run(
          'succeeded-draft',
          JSON.stringify({
            schemaVersion: 1,
            kind: 'question_proposals',
            proposals: [{
              temporaryId: 'Q-1', text: '확인할 내용', reason: '누락 확인',
              suggestedAssigneeId: fixture.scope.actorId, requiredGate: 'G1',
              sourceRefs: [], candidateAnswers: [],
            }],
          }),
          JSON.stringify({ kind: 'provider', sourceRunId: succeeded.value.runId }),
          '2026-09-09T02:02:00.000Z',
          fixture.scope.projectId,
          fixture.scope.srId,
          succeeded.value.runId,
        );
        app.db.prepare(
          `UPDATE generation_runs SET status='succeeded',revision=2,result_draft_id=?,
                  finished_at='2026-09-09T02:02:00.000Z'
            WHERE project_id=? AND sr_id=? AND run_id=?`,
        ).run('succeeded-draft', fixture.scope.projectId, fixture.scope.srId, succeeded.value.runId);
      }).immediate();
      expect(service.retryGeneration(
        command(fixture.scope, fixture.guard, 'retry-succeeded'), succeeded.value.runId,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });

  it('running 취소는 기존 slot·claim·종료 관찰을 보존하고 confirmed 결과를 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const service = serviceFor(app);
      const requested = service.requestGeneration(
        command(fixture.scope, fixture.guard, 'running-source'), fixture.input,
      );
      if (requested.kind !== 'Committed') throw new Error('running fixture 접수 실패');
      const runtime = app.db.prepare('SELECT runtime_id FROM runtime_instances LIMIT 1').get() as {
        readonly runtime_id: string;
      };
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO execution_claims(
             project_id,sr_id,run_id,claim_id,owner_runtime_id,ownership_token_hash,
             claimed_at,execution_policy_ref,launch_intent_id
           ) VALUES(?,?,?,?,?,'sha256:test','2026-09-09T02:00:10.000Z','policy:test','launch-test')`,
        ).run(
          fixture.scope.projectId, fixture.scope.srId, requested.value.runId,
          'claim-test', runtime.runtime_id,
        );
        app.db.prepare(
          `UPDATE generation_runs SET status='running',revision=2,claim_id='claim-test',
                  started_at='2026-09-09T02:00:10.000Z'
            WHERE project_id=? AND sr_id=? AND run_id=?`,
        ).run(fixture.scope.projectId, fixture.scope.srId, requested.value.runId);
        app.db.prepare(
          `UPDATE execution_slot SET project_id=?,sr_id=?,run_id=?,claim_id=?,
                  claim_token_hash='sha256:test',runtime_id=?,launch_intent_id='launch-test'
            WHERE singleton_id=1`,
        ).run(
          fixture.scope.projectId, fixture.scope.srId, requested.value.runId, 'claim-test',
          runtime.runtime_id,
        );
        app.db.prepare(
          `INSERT INTO execution_observations(
             project_id,sr_id,observation_id,run_id,claim_id,observation_kind,
             observed_by_runtime,observed_at,termination_result_json,diagnostic
           ) VALUES(?,?,?,?,?,'termination_confirmed',?,?,'{"kind":"exited","exitCode":130}',?)`,
        ).run(
          fixture.scope.projectId, fixture.scope.srId, 'observation-test',
          requested.value.runId, 'claim-test', runtime.runtime_id,
          '2026-09-09T02:00:20.000Z', '취소 요청 전에 종료를 관찰했습니다.',
        );
      }).immediate();
      expect(readGenerationState(app.db, requested.value.runId)).toMatchObject({
        slot: [requested.value.runId], claims: ['claim-test'], observations: ['observation-test'],
      });
      const context = command(fixture.scope, { kind: 'none' }, 'cancel-running');
      const cancelled = service.cancelGeneration(context, requested.value.runId);
      expect(cancelled).toMatchObject({
        kind: 'Committed',
        value: { status: 'cancelled', termination: 'confirmed', revision: 3 },
        receipt: { committedRevision: 3 },
      });
      expect(readGenerationState(app.db, requested.value.runId)).toMatchObject({
        slot: [requested.value.runId], claims: ['claim-test'], observations: ['observation-test'],
      });
      expect(service.cancelGeneration(
        { ...context, requestId: randomUUID() }, requested.value.runId,
      )).toMatchObject({
        kind: 'Replayed',
        value: { status: 'cancelled', termination: 'confirmed', revision: 3 },
        current: { target: { entityId: requested.value.runId }, currentRevision: 3 },
      });
      expect(readGenerationState(app.db, requested.value.runId)).toMatchObject({
        slot: [requested.value.runId], claims: ['claim-test'], observations: ['observation-test'],
      });
      app.db.prepare('UPDATE srs SET owner_id=? WHERE project_id=? AND sr_id=?').run(
        manifest.personaIds['P-05'], fixture.scope.projectId, fixture.scope.srId,
      );
      expect(service.cancelGeneration(
        { ...context, requestId: randomUUID() }, requested.value.runId,
      )).toMatchObject({
        kind: 'Rejected', error: { code: 'NOT_ASSIGNED' },
      });
    } finally {
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL
          WHERE singleton_id=1`,
      ).run();
      await app.close();
    }
  });

  it('포화 상태의 failed 재시도는 과거 실행을 보존하고 QUEUE_FULL로 거절합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const service = serviceFor(app);
      const old = service.requestGeneration(
        command(fixture.scope, fixture.guard, 'capacity-retry-source'), fixture.input,
      );
      if (old.kind !== 'Committed') throw new Error('retry source 접수 실패');
      app.db.prepare(
        `UPDATE generation_runs SET status='failed',revision=2,error_code='PROVIDER_ERROR',
                finished_at='2026-09-09T02:03:00.000Z'
          WHERE project_id=? AND sr_id=? AND run_id=?`,
      ).run(fixture.scope.projectId, fixture.scope.srId, old.value.runId);
      for (let index = 0; index < 10; index += 1) {
        expect(service.requestGeneration(
          command(fixture.scope, fixture.guard, `capacity-live-${index}`), fixture.input,
        )).toMatchObject({ kind: 'Committed', value: { status: 'pending' } });
      }
      expect(service.getGeneration(query(fixture.scope), old.value.runId)).toMatchObject({ status: 'failed' });
      expect(service.retryGeneration(
        command(fixture.scope, fixture.guard, 'capacity-retry'), old.value.runId,
      )).toMatchObject({ kind: 'Rejected', error: { code: 'QUEUE_FULL' } });
      expect(readGenerationState(app.db)).toMatchObject({
        nonterminalCount: 10,
        runs: expect.arrayContaining([expect.objectContaining({ runId: old.value.runId, status: 'failed' })]),
      });
    } finally {
      await app.close();
    }
  });
});

type FixtureScope = Awaited<ReturnType<typeof createGenerationFixture>>['scope'];

function actor(scope: FixtureScope, actorId = scope.actorId) {
  return { actorId, projectId: scope.projectId, roles: [], srAssignments: [], demo: true as const };
}

function command<G extends FingerprintGuard | NoGuard>(scope: FixtureScope, guard: G, idempotencyKey: string) {
  return {
    actor: actor(scope),
    scope: { kind: 'sr', projectId: scope.projectId, srId: scope.srId } as SrScope,
    requestId: randomUUID(),
    idempotencyKey,
    guard,
  };
}

function query(scope: FixtureScope, actorId = scope.actorId) {
  return {
    actor: actor(scope, actorId),
    scope: { kind: 'sr', projectId: scope.projectId, srId: scope.srId } as SrScope,
  };
}

function serviceFor(
  app: Awaited<ReturnType<typeof createTestApp>>,
  cancellationNotifications?: { notifyCancellation(scope: SrScope, runId: string): void },
  overrides: {
    readonly providerInputBytes?: number;
    readonly maxNonterminal?: number;
    readonly selection?: { readonly providerId: string; readonly modelChoice: { readonly kind: 'installed_default' } | { readonly kind: 'explicit'; readonly modelId: string } };
  } = {},
) {
  const rules = loadProjectRuleSource(process.cwd()).rules;
  const config = loadRuntimeConfig(process.cwd(), {
    PLANREPO_MODE: 'test', PLANREPO_TEST_RUN_ID: randomUUID(),
  });
  return createGenerationService({
    persistence: createPersistence(app.db),
    projectRules: rules,
    selection: overrides.selection ?? {
      providerId: config.generation.providerId,
      modelChoice: config.generation.modelChoice,
    },
    maxNonterminal: overrides.maxNonterminal ?? config.generation.maxNonterminal,
    providerInputBytes: overrides.providerInputBytes ?? config.limits.providerInputBytes,
    currentInputFingerprints: createCurrentInputFingerprintPort(rules),
    ...(cancellationNotifications === undefined ? {} : { cancellationNotifications }),
    now: () => '2026-09-09T02:00:00.000Z',
  });
}
