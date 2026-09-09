import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readGenerationState } from '@/tests/helpers/generation-fixture';
import { createRecoveryRig } from '@/tests/helpers/recovery-rig';
import { createTestApp } from '@/tests/helpers/test-app';
import { createGenerationRecoveryService } from '@/src/generation-runtime/recovery';
import { createPersistence } from '@/src/persistence/transaction';
import { createGenerationFixture } from '@/tests/helpers/generation-fixture';
import { registerRuntime } from '@/src/persistence/maintenance';
import { createMacosRecoveryObservationPort } from '@/src/runtime/macos-observation';

describe('M-039 generation recovery', () => {
  it('keeps same-boot recovery unknown without strong identity even when the owner PID is absent', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const rig = createRecoveryRig(app);
    try {
      const before = await rig.prepareClaim();
      const report = await rig.restartWithObservation({
        source: 'Test', hostRelation: 'same', bootRelation: 'same', hostRebootEvidence: 'unavailable',
        startIdentity: 'unavailable', ownerPidCheck: 'ESRCH',
        executionTermination: 'unknown',
      });
      expect(report).toMatchObject({
        classification: 'Unknown', goalMet: false, inspectedCount: 1,
        unresolvedRunIds: [before.runId],
      });
      const state = readGenerationState(app.db, before.runId);
      expect(state.runs[0]?.status).toBe('running');
      expect(state.activeSlot?.claimId).toBe(before.claimId);
      expect(state.observations).toHaveLength(0);
      expect(rig.signals()).toHaveLength(0);
      const row = app.db.prepare(
        'SELECT project_id,sr_id,requested_by FROM generation_runs WHERE run_id=?',
      ).get(before.runId) as { readonly project_id: string; readonly sr_id: string; readonly requested_by: string };
      const readable = await app.invoke('M-033', {
        actorId: row.requested_by, projectId: row.project_id, srId: row.sr_id,
      }, before.runId);
      expect(readable).toMatchObject({ ok: true, value: { status: 'running' } });
    } finally {
      rig.cleanup();
      await app.close();
    }
  });

  it.each([
    {
      name: 'same-host reboot',
      observation: {
        source: 'Test' as const, hostRelation: 'same' as const, bootRelation: 'different' as const,
        hostRebootEvidence: 'confirmed' as const,
        startIdentity: 'unavailable' as const, ownerPidCheck: 'unavailable' as const,
        executionTermination: 'unknown' as const,
      },
    },
    {
      name: 'direct owner exit',
      observation: {
        source: 'Test' as const, hostRelation: 'same' as const, bootRelation: 'same' as const,
        hostRebootEvidence: 'unavailable' as const,
        startIdentity: 'confirmed_owner_exit' as const, ownerPidCheck: 'ESRCH' as const,
        executionTermination: 'unknown' as const,
      },
    },
  ])('marks running interrupted only with strong $name evidence and retains its slot', async ({ observation }) => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const rig = createRecoveryRig(app);
    try {
      const before = await rig.prepareClaim();
      const report = await rig.restartWithObservation(observation);
      expect(report).toMatchObject({
        classification: 'KnownInterrupted', goalMet: true,
        recoveredRunIds: [before.runId], failedRunIds: [before.runId],
        unresolvedRunIds: [before.runId],
      });
      const state = readGenerationState(app.db, before.runId);
      expect(state.runs[0]?.status).toBe('failed');
      expect(state.activeSlot?.claimId).toBe(before.claimId);
      expect(state.observations).toHaveLength(0);
      expect(app.db.prepare(
        "SELECT count(*) AS count FROM activity_events WHERE event_type='generation_failed' AND sr_id IS NOT NULL",
      ).get()).toEqual({ count: 1 });
    } finally {
      rig.cleanup();
      await app.close();
    }
  });

  it('records M-050 and releases only the matching slot for a confirmed same-host reboot', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const rig = createRecoveryRig(app);
    try {
      const before = await rig.prepareClaim();
      const report = await rig.restartWithObservation({
        source: 'Test', hostRelation: 'same', bootRelation: 'different', hostRebootEvidence: 'confirmed',
        startIdentity: 'unavailable', ownerPidCheck: 'unavailable',
        executionTermination: 'confirmed',
      });
      expect(report).toMatchObject({
        classification: 'KnownInterrupted', goalMet: true,
        failedRunIds: [before.runId], unresolvedRunIds: [], unresolvedRuntimeIds: [],
      });
      const state = readGenerationState(app.db, before.runId);
      expect(state.runs[0]?.status).toBe('failed');
      expect(state.activeSlot).toBeUndefined();
      expect(state.observations).toHaveLength(1);
      expect(app.db.prepare(
        'SELECT termination_result_json FROM execution_observations WHERE run_id=?',
      ).get(before.runId)).toEqual({
        termination_result_json: JSON.stringify({
          kind: 'host_reboot_confirmed',
          evidence: 'same physical host identity and changed boot session',
        }),
      });
    } finally {
      rig.cleanup();
      await app.close();
    }
  });

  it('does not treat a different host plus boot change as reboot evidence', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const rig = createRecoveryRig(app);
    try {
      const before = await rig.prepareClaim();
      const report = await rig.restartWithObservation({
        source: 'Test', hostRelation: 'different', bootRelation: 'different', hostRebootEvidence: 'unavailable',
        startIdentity: 'unavailable', ownerPidCheck: 'ESRCH', executionTermination: 'unknown',
      });
      expect(report).toMatchObject({
        classification: 'Unknown', goalMet: false, unresolvedRunIds: [before.runId],
      });
      expect(readGenerationState(app.db, before.runId).runs[0]?.status).toBe('running');
      expect(rig.signals()).toEqual([]);
    } finally {
      rig.cleanup();
      await app.close();
    }
  });

  it('does not promote macOS UUID comparison alone to a strong reboot capability', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const hostId = `sha256:${'a'.repeat(64)}`;
    const rig = createRecoveryRig(app, {
      previousHostId: hostId,
      previousBootId: `sha256:${'b'.repeat(64)}`,
    });
    try {
      const before = await rig.prepareClaim();
      const report = await createGenerationRecoveryService({
        persistence: createPersistence(app.db),
        currentRuntimeId: app.generationRuntime.runtimeId,
        observations: createMacosRecoveryObservationPort({
          hostId, bootId: `sha256:${'c'.repeat(64)}`, parentPid: process.pid,
          parentStartedAt: 'unavailable', recoveryObservation: 'available',
        }),
      }).reconcile();
      expect(report).toMatchObject({
        classification: 'Unknown', goalMet: false, unresolvedRunIds: [before.runId],
      });
      expect(readGenerationState(app.db, before.runId).runs[0]?.status).toBe('running');
    } finally {
      rig.cleanup();
      await app.close();
    }
  });

  it('preserves a terminal winner and does not create a recovery failure activity', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const rig = createRecoveryRig(app);
    try {
      const before = await rig.prepareClaim();
      const row = app.db.prepare(
        'SELECT project_id,sr_id,requested_by FROM generation_runs WHERE run_id=?',
      ).get(before.runId) as { readonly project_id: string; readonly sr_id: string; readonly requested_by: string };
      const cancelled = await app.invoke('M-034', {
        actorId: row.requested_by, projectId: row.project_id, srId: row.sr_id,
        idempotencyKey: 'recovery-terminal-cancel',
      }, before.runId);
      expect(cancelled.ok).toBe(true);
      const report = await rig.restartWithObservation({
        source: 'Test', hostRelation: 'same', bootRelation: 'different', hostRebootEvidence: 'confirmed',
        startIdentity: 'unavailable', ownerPidCheck: 'ESRCH', executionTermination: 'unknown',
      });
      expect(report).toMatchObject({ classification: 'PreservedTerminal', goalMet: false });
      expect(readGenerationState(app.db, before.runId).runs[0]?.status).toBe('cancelled');
      expect(app.db.prepare(
        "SELECT count(*) AS count FROM activity_events WHERE event_type='generation_failed'",
      ).get()).toEqual({ count: 0 });
    } finally {
      rig.cleanup();
      await app.close();
    }
  });

  it('preserves pending work when no slot exists and does not call the observation port', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'recovery-pending', guard: fixture.guard,
      }, fixture.input);
      if (!requested.ok) throw new Error(requested.error.code);
      let observed = false;
      const report = await createGenerationRecoveryService({
        persistence: createPersistence(app.db),
        currentRuntimeId: app.generationRuntime.runtimeId,
        observations: {
          async observe() {
            observed = true;
            throw new Error('slot이 없으면 관찰하면 안 됩니다.');
          },
        },
      }).reconcile();
      expect(report).toMatchObject({
        classification: 'PreservedTerminal', goalMet: true, inspectedCount: 0,
      });
      expect(observed).toBe(false);
      expect(readGenerationState(app.db, requested.value.runId).runs[0]?.status).toBe('pending');
    } finally {
      await app.close();
    }
  });

  it('keeps claims blocked when a slot-free previous runtime has no strong termination evidence', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const oldRuntimeId = `runtime-stale-${randomUUID()}`;
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'recovery-stale-runtime', guard: fixture.guard,
      }, fixture.input);
      if (!requested.ok) throw new Error(requested.error.code);
      registerRuntime(app.db, {
        runtimeId: oldRuntimeId, hostId: 'sha256:old-host', bootId: 'sha256:old-boot',
        parentPid: process.pid + 2000, parentStartedAt: 'unavailable',
        registeredAt: '2026-09-09T06:20:00.000Z',
      });
      const report = await createGenerationRecoveryService({
        persistence: createPersistence(app.db), currentRuntimeId: app.generationRuntime.runtimeId,
        observations: {
          async observe() {
            return {
              source: 'Test' as const, hostRelation: 'same' as const, bootRelation: 'same' as const,
              hostRebootEvidence: 'unavailable' as const,
              startIdentity: 'unavailable' as const, ownerPidCheck: 'ESRCH' as const,
              executionTermination: 'unknown' as const,
            };
          },
        },
      }).reconcile();
      expect(report).toMatchObject({
        classification: 'Unknown', goalMet: false,
        unresolvedRunIds: [], unresolvedRuntimeIds: [oldRuntimeId],
      });
      expect(readGenerationState(app.db, requested.value.runId).runs[0]?.status).toBe('pending');
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM runtime_instances WHERE runtime_id=?',
      ).get(oldRuntimeId)).toEqual({ count: 1 });
    } finally {
      app.db.prepare('DELETE FROM runtime_instances WHERE runtime_id=?').run(oldRuntimeId);
      await app.close();
    }
  });

  it('rolls back interrupted status when its activity insert fails', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const rig = createRecoveryRig(app);
    try {
      const before = await rig.prepareClaim();
      app.db.exec(`CREATE TEMP TRIGGER fail_recovery_activity BEFORE INSERT ON activity_events
        WHEN NEW.event_type='generation_failed' BEGIN SELECT RAISE(ABORT,'late recovery activity failure'); END`);
      await expect(rig.restartWithObservation({
        source: 'Test', hostRelation: 'same', bootRelation: 'same', hostRebootEvidence: 'unavailable',
        startIdentity: 'confirmed_owner_exit', ownerPidCheck: 'ESRCH', executionTermination: 'unknown',
      })).rejects.toThrow('late recovery activity failure');
      const state = readGenerationState(app.db, before.runId);
      expect(state.runs[0]?.status).toBe('running');
      expect(state.activeSlot?.claimId).toBe(before.claimId);
    } finally {
      rig.cleanup();
      await app.close();
    }
  });
});
