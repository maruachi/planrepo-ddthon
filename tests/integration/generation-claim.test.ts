import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';
import {
  createInternalGenerationRig,
  terminationFixture,
  validDraft,
} from '@/tests/helpers/internal-generation-rig';
import { createTestApp } from '@/tests/helpers/test-app';
import { registerRuntime, unregisterRuntime } from '@/src/persistence/maintenance';
import { startRuntimeWorker } from '@/tests/helpers/runtime-workers';

describe('내부 생성 claim과 terminal 저장', () => {
  it('preserves cancellation until matching termination and ignores old observations after a new claim', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { scope, input, guard } = await createGenerationFixture(app);
      const first = await app.invoke(
        'M-032', { ...scope, guard, idempotencyKey: 'claim-r1' }, input,
      );
      if (!first.ok) throw new Error(first.error.code);
      const rig = createInternalGenerationRig(app);
      const c1 = await rig.claim();
      expect(c1).not.toBeNull();
      if (c1 === null) throw new Error('first claim missing');
      expect(readGenerationState(app.db).activeSlot).toEqual({
        runId: c1.runId, claimId: c1.claimId,
      });
      const storedClaim = app.db.prepare(
        `SELECT c.ownership_token_hash,c.launch_intent_id,s.claim_token_hash,s.launch_intent_id AS slot_launch
           FROM execution_claims c JOIN execution_slot s
             ON s.run_id=c.run_id AND s.claim_id=c.claim_id
          WHERE c.run_id=? AND c.claim_id=?`,
      ).get(c1.runId, c1.claimId) as {
        readonly ownership_token_hash: string;
        readonly launch_intent_id: string;
        readonly claim_token_hash: string;
        readonly slot_launch: string;
      };
      expect(storedClaim).toMatchObject({
        ownership_token_hash: expect.stringMatching(/^sha256:/u),
        claim_token_hash: storedClaim.ownership_token_hash,
        slot_launch: storedClaim.launch_intent_id,
      });
      expect(storedClaim.ownership_token_hash).not.toContain(rig.unsafeClaimRef(c1).ownershipToken);
      expect(await app.invoke(
        'M-034', { ...scope, idempotencyKey: 'cancel-r1' }, first.value.runId,
      )).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(await rig.complete(c1, validDraft(c1))).toMatchObject({
        kind: 'IgnoredTerminal', run: { status: 'cancelled' },
      });
      expect(readGenerationState(app.db).activeSlot).toEqual({
        runId: c1.runId, claimId: c1.claimId,
      });

      const second = await app.invoke(
        'M-032', { ...scope, guard, idempotencyKey: 'claim-r2' }, input,
      );
      if (!second.ok) throw new Error(second.error.code);
      expect(await rig.claim()).toBeNull();
      const observation = terminationFixture(c1, { kind: 'confirmed_test_child_close' });
      expect(await rig.observe(c1, observation)).toMatchObject({
        claimRef: { runId: c1.runId, claimId: c1.claimId },
        result: { kind: 'exited', exitCode: 0 },
      });
      const c2 = await rig.claim();
      expect(c2).not.toBeNull();
      if (c2 === null) throw new Error('second claim missing');
      expect(readGenerationState(app.db).activeSlot).toEqual({
        runId: c2.runId, claimId: c2.claimId,
      });
      expect(await rig.observe(
        c1, terminationFixture(c1, { kind: 'no_process_created' }),
      )).toMatchObject({
        claimRef: { runId: c1.runId, claimId: c1.claimId },
        result: { kind: 'exited', exitCode: 0 },
      });
      expect(readGenerationState(app.db).activeSlot).toEqual({
        runId: c2.runId, claimId: c2.claimId,
      });
      expect(readGenerationState(app.db, c1.runId).observations).toHaveLength(1);
      await app.invoke('M-034', { ...scope, idempotencyKey: 'cancel-r2' }, second.value.runId);
      await rig.observe(c2, terminationFixture(c2, { kind: 'no_process_created' }));
    } finally {
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL
          WHERE singleton_id=1`,
      ).run();
      await app.close();
    }
  });

  it('성공을 첫 terminal로 저장하고 실제 실행 보고서와 늦은 실패를 분리합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'complete-r1' }, fixture.input,
      );
      if (!requested.ok) throw new Error(requested.error.code);
      const rig = createInternalGenerationRig(app);
      const claim = await rig.claim();
      if (claim === null) throw new Error('claim missing');
      const beforeEdit = await app.invoke('M-047', fixture.scope, {});
      if (!beforeEdit.ok) throw new Error(beforeEdit.error.code);
      const edited = await app.invoke('M-005', {
        ...fixture.scope,
        idempotencyKey: 'complete-input-change',
        guard: {
          resource: {
            target: {
              kind: 'sr', projectId: fixture.scope.projectId,
              srId: fixture.scope.srId, entityId: fixture.scope.srId,
            },
            expectedRevision: beforeEdit.value.sr.revision,
          },
        },
      }, {
        title: beforeEdit.value.sr.title,
        purpose: beforeEdit.value.currentDescription.purpose,
        description: `${beforeEdit.value.currentDescription.description}\nclaim 뒤 현재 입력 변경`,
        changeReason: 'stale 생성 초안 보존 검증',
      });
      if (!edited.ok) throw new Error(edited.error.code);
      expect(await rig.complete(claim, validDraft(claim))).toMatchObject({
        kind: 'Recorded',
        run: {
          status: 'succeeded', actualModelId: 'test-model-confirmed', cliVersion: 'test-cli-1',
          requestedSelection: requested.value.requestedSelection,
        },
      });
      expect(await rig.fail(claim)).toMatchObject({
        kind: 'IgnoredTerminal', run: { status: 'succeeded' },
      });
      expect(await rig.control(claim)).toEqual({
        runId: claim.runId, status: 'succeeded', cancelRequested: false, termination: 'unobserved',
      });
      expect(await app.invoke('M-033', fixture.scope, claim.runId)).toMatchObject({
        ok: true, value: { status: 'succeeded', freshness: 'stale' },
      });
      const detail = await app.invoke('M-047', fixture.scope, {});
      if (!detail.ok) throw new Error(detail.error.code);
      expect(detail.value.generationRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: claim.runId, status: 'succeeded',
          actualModelId: 'test-model-confirmed', cliVersion: 'test-cli-1',
        }),
      ]));
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM generation_drafts WHERE source_run_id=?',
      ).get(claim.runId)).toEqual({ count: 1 });
      await rig.observe(claim, terminationFixture(claim, { kind: 'confirmed_test_child_close' }));
    } finally {
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      await app.close();
    }
  });

  it('출력·deadline·activity 실패가 terminal과 초안을 부분 저장하지 않습니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'rollback-r1' }, fixture.input,
      );
      if (!requested.ok) throw new Error(requested.error.code);
      const rig = createInternalGenerationRig(app);
      const claim = await rig.claim();
      if (claim === null) throw new Error('claim missing');
      rig.setMonotonicNow(101);
      await expect(rig.complete(claim, validDraft(claim), { deadlineMono: 100 }))
        .rejects.toThrow('monotonic deadline');
      expect(readGenerationState(app.db, claim.runId).runs[0]?.status).toBe('running');
      expect(app.db.prepare('SELECT count(*) AS count FROM generation_drafts').get()).toEqual({ count: 0 });

      rig.setMonotonicNow(50);
      app.db.function('advance_completion_clock', () => {
        rig.setMonotonicNow(101);
        return 1;
      });
      app.db.exec(`CREATE TRIGGER advance_completion_deadline BEFORE INSERT ON activity_events
        WHEN NEW.event_type='generation_completed'
        BEGIN SELECT advance_completion_clock(); END`);
      await expect(rig.complete(claim, validDraft(claim), { deadlineMono: 100 }))
        .rejects.toThrow('monotonic deadline');
      expect(readGenerationState(app.db, claim.runId).runs[0]?.status).toBe('running');
      expect(app.db.prepare('SELECT count(*) AS count FROM generation_drafts').get()).toEqual({ count: 0 });
      app.db.exec('DROP TRIGGER advance_completion_deadline');
      rig.setMonotonicNow(50);

      await expect(rig.complete(claim, {
        schemaVersion: 1,
        kind: 'artifact',
        documentKind: 'requirements',
        markdown: '# wrong task',
        requirementRefs: [],
        changeSummary: 'wrong task',
      })).rejects.toThrow('결과 종류');
      const baseDraft = validDraft(claim);
      if (baseDraft.kind !== 'question_proposals') throw new Error('질문 fixture가 아닙니다.');
      await expect(rig.complete(claim, {
        ...baseDraft,
        proposals: [{
          ...baseDraft.proposals[0],
          temporaryId: 'large-proposal',
          text: '가'.repeat(2_097_152),
        }],
      })).rejects.toThrow('저장 한도');
      expect(app.db.prepare('SELECT count(*) AS count FROM generation_drafts').get()).toEqual({ count: 0 });

      app.db.exec(`CREATE TRIGGER fail_internal_completion_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='generation_completed'
        BEGIN SELECT RAISE(ABORT, 'late completion activity failure'); END`);
      await expect(rig.complete(claim, validDraft(claim))).rejects.toThrow();
      expect(readGenerationState(app.db, claim.runId).runs[0]?.status).toBe('running');
      expect(app.db.prepare('SELECT count(*) AS count FROM generation_drafts').get()).toEqual({ count: 0 });
      app.db.exec('DROP TRIGGER fail_internal_completion_activity');
      expect(await rig.complete(claim, validDraft(claim))).toMatchObject({
        kind: 'Recorded', run: { status: 'succeeded' },
      });
      await rig.observe(claim, terminationFixture(claim, { kind: 'confirmed_test_child_close' }));
    } finally {
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      await app.close();
    }
  });

  it('잘못된 token과 다른 runtime owner를 거절하고 실패 terminal을 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const secondRuntimeId = `runtime-${randomUUID()}`;
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'failure-r1' }, fixture.input,
      );
      if (!requested.ok) throw new Error(requested.error.code);
      const rig = createInternalGenerationRig(app);
      const claim = await rig.claim();
      if (claim === null) throw new Error('claim missing');
      const originalRef = rig.unsafeClaimRef(claim);
      expect(await rig.complete(claim, validDraft(claim), {
        claimRef: { ...originalRef, ownershipToken: 'wrong-token' },
      })).toMatchObject({ kind: 'RejectedOwnership', error: { code: 'FORBIDDEN' } });
      await expect(rig.controlWithClaimRef({ ...originalRef, runId: 'another-run' }))
        .rejects.toThrow('소유권');

      registerRuntime(app.db, {
        runtimeId: secondRuntimeId,
        hostId: 'test-host-2',
        bootId: 'test-boot-2',
        parentPid: process.pid,
        parentStartedAt: 'test',
        registeredAt: '2026-09-09T03:00:00.000Z',
      });
      const otherRuntimeRig = createInternalGenerationRig(app, secondRuntimeId);
      expect(await otherRuntimeRig.complete(claim, validDraft(claim), { claimRef: originalRef }))
        .toMatchObject({ kind: 'RejectedOwnership', error: { code: 'FORBIDDEN' } });

      expect(await rig.fail(
        claim,
        { code: 'TIMEOUT', diagnostic: 'test monotonic timeout' },
        { exitCode: 124 },
      )).toMatchObject({ kind: 'Recorded', run: { status: 'failed', error: { code: 'TIMEOUT' } } });
      expect(await app.invoke(
        'M-034', { ...fixture.scope, idempotencyKey: 'cancel-after-fail' }, claim.runId,
      )).toMatchObject({ ok: false, error: { code: 'RUN_FINAL' } });
      expect(await rig.complete(claim, validDraft(claim))).toMatchObject({
        kind: 'IgnoredTerminal', run: { status: 'failed', error: { code: 'TIMEOUT' } },
      });
      const verifiedTermination = terminationFixture(claim, { kind: 'confirmed_test_child_close' });
      await expect(rig.observe(claim, { ...verifiedTermination }))
        .rejects.toThrow('검증된 종료 observation 증거');
      await rig.observe(claim, verifiedTermination);
      unregisterRuntime(app.db, secondRuntimeId);
    } finally {
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      app.db.prepare('DELETE FROM runtime_instances WHERE runtime_id=?').run(secondRuntimeId);
      await app.close();
    }
  });

  it('별도 Node worker 둘의 claim과 같은 key 접수 경합을 SQLite가 하나로 확정합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const workers: Array<Awaited<ReturnType<typeof startRuntimeWorker>>> = [];
    try {
      const fixture = await createGenerationFixture(app);
      const pending = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'worker-claim-source' }, fixture.input,
      );
      if (!pending.ok) throw new Error(pending.error.code);
      const claimWorkers = [];
      for (const testWorkerId of ['claim-a', 'claim-b']) {
        const worker = await startRuntimeWorker({
          app, testWorkerId, barrier: 'claim-race', closeConfirmationTimeoutMs: 25,
          operation: { kind: 'claim', closeDelayMs: 100 },
        });
        workers.push(worker);
        await worker.ready;
        const ready = JSON.parse(await readFile(join(
          dirname(dirname(app.db.name)), 'control', testWorkerId, 'READY.json',
        ), 'utf8')) as Record<string, unknown>;
        expect(ready).toMatchObject({
          runtimeId: `test-runtime-${testWorkerId}`,
          ownerPid: expect.any(Number),
          executionMode: 'direct-owned-node',
        });
        claimWorkers.push(worker);
      }
      await Promise.all(claimWorkers.map(({ release }) => release()));
      const claimResults = await Promise.all(claimWorkers.map(({ result }) => result));
      expect(claimResults.every((result) => result.kind === 'claim' && result.errorCode === undefined)).toBe(true);
      expect(claimResults.filter((result) => result.kind === 'claim' && result.runId !== undefined)).toHaveLength(1);
      expect(claimResults.filter((result) =>
        result.kind === 'claim' && result.runId === undefined && result.errorCode === undefined)).toHaveLength(1);
      expect(readGenerationState(app.db)).toMatchObject({ nonterminalCount: 1 });
      expect(app.db.prepare('SELECT count(*) AS count FROM execution_claims').get()).toEqual({ count: 1 });
      const winningIndex = claimResults.findIndex((result) => result.kind === 'claim' && result.runId !== undefined);
      if (winningIndex < 0) throw new Error('claim winner missing');
      const losingIndex = 1 - winningIndex;
      await expect(claimWorkers[losingIndex]?.close())
        .rejects.toThrow('실제 DB owner process 종료를 확인하지 못했습니다');
      expect(readGenerationState(app.db).activeSlot?.runId).toBe(pending.value.runId);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM runtime_instances WHERE runtime_id=?',
      ).get(`test-runtime-claim-${losingIndex === 0 ? 'a' : 'b'}`)).toEqual({ count: 1 });
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 150));
      await claimWorkers[losingIndex]?.close();
      const winnerId = winningIndex === 0 ? 'claim-a' : 'claim-b';
      const winnerReadyPath = join(
        dirname(dirname(app.db.name)), 'control', winnerId, 'READY.json',
      );
      const winnerReady = JSON.parse(await readFile(winnerReadyPath, 'utf8')) as Record<string, unknown>;
      expect(winnerReady.ownerPid).toBe(winnerReady.managerPid);
      await claimWorkers[winningIndex]?.crashOwnedWorker();
      const ownerExit = JSON.parse(await readFile(join(
        dirname(dirname(app.db.name)), 'control', winnerId, 'OWNER_EXIT.json',
      ), 'utf8')) as Record<string, unknown>;
      expect(ownerExit).toMatchObject({
        runtimeId: `test-runtime-${winnerId}`,
        termination: 'confirmed-owner-exit',
      });
      expect(readGenerationState(app.db).activeSlot?.runId).toBe(pending.value.runId);

      app.db.transaction(() => {
        app.db.prepare(
          `UPDATE generation_runs SET status='failed',revision=revision+1,error_code='INTERRUPTED',
                  finished_at='2026-09-09T04:01:00.000Z'
            WHERE project_id=? AND sr_id=? AND run_id=? AND status='running'`,
        ).run(fixture.scope.projectId, fixture.scope.srId, pending.value.runId);
        app.db.prepare(
          `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                  claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
        ).run();
        app.db.prepare("DELETE FROM runtime_instances WHERE runtime_id LIKE 'test-runtime-claim-%'").run();
      }).immediate();

      const requestOperation = {
        kind: 'request' as const,
        scope: { kind: 'sr' as const, projectId: fixture.scope.projectId, srId: fixture.scope.srId },
        actorId: fixture.scope.actorId,
        idempotencyKey: 'worker-same-key',
        guard: fixture.guard,
        input: fixture.input,
      };
      const requestWorkers = [];
      for (const testWorkerId of ['request-a', 'request-b']) {
        const worker = await startRuntimeWorker({
          app, testWorkerId, barrier: 'request-race', operation: requestOperation,
        });
        workers.push(worker);
        await worker.ready;
        requestWorkers.push(worker);
      }
      await Promise.all(requestWorkers.map(({ release }) => release()));
      const requestResults = await Promise.all(requestWorkers.map(({ result }) => result));
      expect(requestResults.map((result) => result.kind === 'request' ? result.disposition : 'wrong').sort())
        .toEqual(['Committed', 'Replayed']);
      const runIds = requestResults.flatMap((result) =>
        result.kind === 'request' && result.runId !== undefined ? [result.runId] : []);
      expect(new Set(runIds).size).toBe(1);
      await Promise.all(requestWorkers.map(({ close }) => close()));
      expect(app.db.prepare(
        `SELECT count(*) AS count FROM command_receipts
          WHERE command_kind='M-032' AND idempotency_key='worker-same-key'`,
      ).get()).toEqual({ count: 1 });
    } finally {
      const stopped = await Promise.allSettled(workers.map(({ close }) => close()));
      const stopFailure = stopped.find((result) => result.status === 'rejected');
      if (stopFailure?.status === 'rejected') throw stopFailure.reason;
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      app.db.prepare("DELETE FROM runtime_instances WHERE runtime_id LIKE 'test-runtime-%'").run();
      await app.close();
    }
  }, 30_000);

  it('FIFO 순서로 인수하고 slot과 running Run의 모순에서는 새 claim을 막습니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const later = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'fifo-later' }, fixture.input,
      );
      const earlier = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'fifo-earlier' }, fixture.input,
      );
      if (!later.ok || !earlier.ok) throw new Error('FIFO fixture 접수 실패');
      app.db.prepare('UPDATE generation_runs SET requested_at=? WHERE run_id=?')
        .run('2026-09-09T05:00:02.000Z', later.value.runId);
      app.db.prepare('UPDATE generation_runs SET requested_at=? WHERE run_id=?')
        .run('2026-09-09T05:00:01.000Z', earlier.value.runId);
      const rig = createInternalGenerationRig(app);
      await expect(rig.claimWithRuntime({
        ...rig.unsafeRuntimeContext(), ownershipCapability: 'wrong-runtime-capability',
      })).rejects.toThrow('runtime capability');
      expect(app.db.prepare('SELECT count(*) AS count FROM execution_claims').get()).toEqual({ count: 0 });
      const claimed = await rig.claim();
      expect(claimed?.runId).toBe(earlier.value.runId);
      if (claimed === null) throw new Error('FIFO claim missing');
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      await expect(rig.claim()).rejects.toThrow('slot과 running Run 상태');
      expect(readGenerationState(app.db).runs).toEqual(expect.arrayContaining([
        expect.objectContaining({ runId: earlier.value.runId, status: 'running' }),
        expect.objectContaining({ runId: later.value.runId, status: 'pending' }),
      ]));
    } finally {
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      await app.close();
    }
  });

  it('M-050 관찰이 취소보다 먼저 와도 M-034 확정과 replay가 confirmed를 유지합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke(
        'M-032', { ...fixture.scope, guard: fixture.guard, idempotencyKey: 'observed-cancel-source' }, fixture.input,
      );
      if (!requested.ok) throw new Error(requested.error.code);
      const rig = createInternalGenerationRig(app);
      const claim = await rig.claim();
      if (claim === null) throw new Error('claim missing');
      expect(await rig.observe(
        claim, terminationFixture(claim, { kind: 'confirmed_test_child_close' }),
      )).toMatchObject({ result: { kind: 'exited' } });
      expect(readGenerationState(app.db).activeSlot).toBeUndefined();
      const context = {
        ...fixture.scope,
        requestId: randomUUID(),
        idempotencyKey: 'observed-cancel',
      };
      expect(await app.invoke('M-034', context, claim.runId)).toMatchObject({
        ok: true, disposition: 'Committed',
        value: { status: 'cancelled', termination: 'confirmed' },
      });
      expect(await app.invoke(
        'M-034', { ...context, requestId: randomUUID() }, claim.runId,
      )).toMatchObject({
        ok: true, disposition: 'Replayed',
        value: { status: 'cancelled', termination: 'confirmed' },
      });
    } finally {
      await app.close();
    }
  });
});
