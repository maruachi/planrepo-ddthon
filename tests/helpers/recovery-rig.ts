import { randomUUID } from 'node:crypto';
import { createGenerationInternalService } from '@/src/application/generation-internal';
import { ClaimContextAuthority } from '@/src/generation-runtime/claim-context';
import {
  createGenerationRecoveryService,
  type RuntimeRecoveryObservation,
  type RuntimeRecoverySummary,
} from '@/src/generation-runtime/recovery';
import { registerRuntime } from '@/src/persistence/maintenance';
import { createPersistence } from '@/src/persistence/transaction';
import { createGenerationFixture } from '@/tests/helpers/generation-fixture';
import type { TestApp } from '@/tests/helpers/test-app';

export interface RecoveryRig {
  prepareClaim(): Promise<{ readonly runId: string; readonly claimId: string }>;
  restartWithObservation(observation: RuntimeRecoveryObservation): Promise<RuntimeRecoverySummary>;
  signals(): readonly never[];
  cleanup(): void;
}

export function createRecoveryRig(app: TestApp, options: {
  readonly previousHostId?: string;
  readonly previousBootId?: string;
} = {}): RecoveryRig {
  const previousRuntimeId = `test-runtime-recovery-${randomUUID()}`;
  let prepared = false;
  return {
    async prepareClaim() {
      if (prepared) throw new Error('recovery claim을 이미 준비했습니다.');
      prepared = true;
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope,
        idempotencyKey: 'recovery-source-run',
        guard: fixture.guard,
      }, fixture.input);
      if (!requested.ok) throw new Error(`recovery Run 접수 실패: ${requested.error.code}`);
      registerRuntime(app.db, {
        runtimeId: previousRuntimeId,
        hostId: options.previousHostId ?? 'sha256:test-host',
        bootId: options.previousBootId ?? 'sha256:test-boot',
        parentPid: process.pid + 1000,
        parentStartedAt: 'unavailable',
        registeredAt: '2026-09-09T06:00:00.000Z',
      });
      const claims = new ClaimContextAuthority(previousRuntimeId);
      const internal = createGenerationInternalService({
        persistence: createPersistence(app.db),
        claims,
        evidence: { completion: () => undefined, failure: () => false, termination: () => false },
        executionPolicy: app.generationRuntime.executionPolicy,
        draftMaxBytes: app.generationRuntime.draftMaxBytes,
        monotonicClock: { now: () => 0 },
        now: () => '2026-09-09T06:00:01.000Z',
      });
      const claim = internal.claimRun(claims.runtime);
      if (claim === null) throw new Error('recovery Run claim을 만들지 못했습니다.');
      return { runId: claim.claimRef.runId, claimId: claim.claimRef.claimId };
    },
    restartWithObservation(observation) {
      const recovery = createGenerationRecoveryService({
        persistence: createPersistence(app.db),
        currentRuntimeId: app.generationRuntime.runtimeId,
        observations: { async observe() { return observation; } },
        now: () => '2026-09-09T06:00:02.000Z',
      });
      const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
      const internal = createGenerationInternalService({
        persistence: createPersistence(app.db),
        claims,
        recovery,
        evidence: { completion: () => undefined, failure: () => false, termination: () => false },
        executionPolicy: app.generationRuntime.executionPolicy,
        draftMaxBytes: app.generationRuntime.draftMaxBytes,
        monotonicClock: { now: () => 0 },
      });
      return internal.reconcileInterruptedRuns(claims.runtime);
    },
    signals() { return []; },
    cleanup() {
      app.db.prepare(
        `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      app.db.prepare('DELETE FROM runtime_instances WHERE runtime_id=?').run(previousRuntimeId);
    },
  };
}
