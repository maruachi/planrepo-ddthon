import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGenerationRecoveryService } from '@/src/generation-runtime/recovery';
import { createPersistence } from '@/src/persistence/transaction';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';
import { startRuntimeWorker } from '@/tests/helpers/runtime-workers';
import { createTestApp } from '@/tests/helpers/test-app';

describe('CG-14 actual owned runtime crash gaps', () => {
  it('preserves pending work when the exact DB owner exits before claim', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const fixture = await createGenerationFixture(app);
    const requested = await app.invoke('M-032', {
      ...fixture.scope, idempotencyKey: 'crash-before-claim', guard: fixture.guard,
    }, fixture.input);
    if (!requested.ok) throw new Error(requested.error.code);
    const workerId = 'recovery-before-claim';
    const runtimeId = `test-runtime-${workerId}`;
    const worker = await startRuntimeWorker({
      app, testWorkerId: workerId, barrier: 'before-claim', operation: { kind: 'claim' },
    });
    let crashed = false;
    try {
      await worker.ready;
      await worker.crashOwnedWorker();
      crashed = true;
      await expect(worker.result).rejects.toThrow('RESULT 전에 종료');
      const recovery = await createGenerationRecoveryService({
        persistence: createPersistence(app.db),
        currentRuntimeId: app.generationRuntime.runtimeId,
        observations: { async observe() { return worker.confirmedRecoveryObservation(); } },
      }).reconcile();
      expect(recovery).toMatchObject({
        classification: 'KnownInterrupted', unresolvedRuntimeIds: [],
      });
      const state = readGenerationState(app.db, requested.value.runId);
      expect(state.runs).toEqual([expect.objectContaining({ status: 'pending' })]);
      expect(state.activeSlot).toBeUndefined();
      expect(worker.confirmedRecoveryObservation()).toMatchObject({
        source: 'Test', startIdentity: 'confirmed_owner_exit',
      });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM runtime_instances WHERE runtime_id=?',
      ).get(runtimeId)).toEqual({ count: 0 });
    } finally {
      if (!crashed) await worker.close();
      await app.close();
    }
  }, 30_000);

  it('uses exact owned process exit to mark a claimed run interrupted without clearing its slot', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const fixture = await createGenerationFixture(app);
    const requested = await app.invoke('M-032', {
      ...fixture.scope, idempotencyKey: 'crash-after-claim', guard: fixture.guard,
    }, fixture.input);
    if (!requested.ok) throw new Error(requested.error.code);
    const workerId = 'recovery-after-claim';
    const worker = await startRuntimeWorker({
      app, testWorkerId: workerId, barrier: 'after-claim', operation: { kind: 'claim' },
    });
    let crashed = false;
    try {
      await worker.ready;
      await worker.release();
      const claim = await worker.result;
      expect(claim).toMatchObject({ kind: 'claim', runId: requested.value.runId });
      await worker.crashOwnedWorker();
      crashed = true;
      const report = await createGenerationRecoveryService({
        persistence: createPersistence(app.db),
        currentRuntimeId: app.generationRuntime.runtimeId,
        observations: { async observe() { return worker.confirmedRecoveryObservation(); } },
        now: () => '2026-09-09T06:10:00.000Z',
      }).reconcile();
      expect(report).toMatchObject({
        classification: 'KnownInterrupted', failedRunIds: [requested.value.runId],
      });
      const state = readGenerationState(app.db, requested.value.runId);
      expect(state.runs[0]?.status).toBe('failed');
      expect(state.activeSlot?.claimId).toBe(
        claim.kind === 'claim' ? claim.claimId : undefined,
      );
      expect(state.observations).toHaveLength(0);
    } finally {
      if (!crashed) await worker.close();
      await app.close();
    }
  }, 30_000);

  it('preserves the slot when a limited child exists but no whole-execution termination was persisted', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const fixture = await createGenerationFixture(app);
    const requested = await app.invoke('M-032', {
      ...fixture.scope, idempotencyKey: 'crash-after-child-spawn', guard: fixture.guard,
    }, fixture.input);
    if (!requested.ok) throw new Error(requested.error.code);
    const worker = await startRuntimeWorker({
      app,
      testWorkerId: 'recovery-child-gap',
      barrier: 'child-gap',
      operation: { kind: 'claim', spawnChildBeforePidPersistence: true },
    });
    let crashed = false;
    let childStopped = false;
    try {
      await worker.ready;
      await worker.release();
      const child = await worker.childSpawnedBeforePidPersistence();
      const storedOwner = app.db.prepare(
        'SELECT parent_pid FROM runtime_identities WHERE runtime_id=?',
      ).get('test-runtime-recovery-child-gap') as { readonly parent_pid: number };
      expect(child).toMatchObject({
        parentPid: storedOwner.parent_pid,
        phase: 'spawned_before_pid_persistence',
      });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM runtime_identities WHERE parent_pid=?',
      ).get(child.childPid)).toEqual({ count: 0 });
      await worker.crashOwnedWorker();
      crashed = true;
      await expect(worker.result).rejects.toThrow('RESULT 전에 종료');
      const report = await createGenerationRecoveryService({
        persistence: createPersistence(app.db),
        currentRuntimeId: app.generationRuntime.runtimeId,
        observations: { async observe() { return worker.confirmedRecoveryObservation(); } },
      }).reconcile();
      expect(report).toMatchObject({
        classification: 'KnownInterrupted',
        unresolvedRunIds: [requested.value.runId],
      });
      const state = readGenerationState(app.db, requested.value.runId);
      expect(state.runs[0]?.status).toBe('failed');
      expect(state.activeSlot?.runId).toBe(requested.value.runId);
      expect(state.observations).toHaveLength(0);
      await worker.stopSpawnedChild();
      childStopped = true;
    } finally {
      if (!crashed) await worker.close();
      if (crashed && !childStopped) await worker.stopSpawnedChild();
      await app.close();
    }
  }, 30_000);

  it('preserves a succeeded first terminal when the owner exits before M-050', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const fixture = await createGenerationFixture(app);
    const requested = await app.invoke('M-032', {
      ...fixture.scope, idempotencyKey: 'crash-after-success', guard: fixture.guard,
    }, fixture.input);
    if (!requested.ok) throw new Error(requested.error.code);
    const workerId = 'recovery-after-success';
    const worker = await startRuntimeWorker({
      app, testWorkerId: workerId, barrier: 'after-success',
      operation: { kind: 'claim', terminalBeforeObservation: 'succeeded' },
    });
    let crashed = false;
    try {
      await worker.ready;
      await worker.release();
      expect(await worker.result).toMatchObject({
        kind: 'claim', runId: requested.value.runId, terminalStatus: 'succeeded',
      });
      await worker.crashOwnedWorker();
      crashed = true;
      const report = await createGenerationRecoveryService({
        persistence: createPersistence(app.db),
        currentRuntimeId: app.generationRuntime.runtimeId,
        observations: { async observe() { return worker.confirmedRecoveryObservation(); } },
      }).reconcile();
      expect(report).toMatchObject({ classification: 'PreservedTerminal', goalMet: false });
      const state = readGenerationState(app.db, requested.value.runId);
      expect(state.runs[0]?.status).toBe('succeeded');
      expect(state.activeSlot?.runId).toBe(requested.value.runId);
      expect(state.observations).toHaveLength(0);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM generation_drafts WHERE source_run_id=?',
      ).get(requested.value.runId)).toEqual({ count: 1 });
    } finally {
      if (!crashed) await worker.close();
      await app.close();
    }
  }, 30_000);
});
