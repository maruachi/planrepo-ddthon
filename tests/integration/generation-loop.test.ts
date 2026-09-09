import { randomUUID } from 'node:crypto';
import { access, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  GenerationProvider,
  ProviderOutcome,
} from '@/src/providers/generation/provider-contract';
import { createGenerationController } from '@/tests/helpers/generation-controller';
import { createGenerationFixture } from '@/tests/helpers/generation-fixture';
import { createTestApp } from '@/tests/helpers/test-app';
import { GenerationProviderRegistry, ProviderRegistryError } from '@/src/providers/generation/provider-registry';
import { createGenerationInternalService } from '@/src/application/generation-internal';
import { ClaimContextAuthority } from '@/src/generation-runtime/claim-context';
import { ExecutionEvidenceRegistry } from '@/src/generation-runtime/execution-evidence-registry';
import { createGenerationExecutionLoop } from '@/src/generation-runtime/execution-loop';
import { createPersistence } from '@/src/persistence/transaction';
import { noProcessCreated, unknownProcess } from '@/src/runtime/process-evidence';

function succeedingTestAdapter(): GenerationProvider {
  return {
    async generate(request): Promise<ProviderOutcome> {
      return {
        kind: 'completed',
        result: {
          schemaVersion: 1,
          kind: 'question_proposals',
          proposals: [{
            temporaryId: 'proposal-loop-1',
            text: '어떤 결과를 확인해야 하나요?',
            reason: '생성 loop의 저장 결과를 확인합니다.',
            suggestedAssigneeId: 'persona-p01-owner',
            requiredGate: 'G1',
            sourceRefs: [],
            candidateAnswers: [],
          }],
        },
        execution: {
          providerId: request.selection.providerId,
          actualModelId: 'test-adapter-model',
          cliVersion: 'test-adapter-1',
          profileVersion: 'claude-cli-2.1.265-planrepo-v2',
          startedAt: '2026-09-09T03:00:00.000Z',
          finishedAt: '2026-09-09T03:00:01.000Z',
          exitCode: 0,
          stdoutBytes: 256,
          stderrBytes: 0,
          stdoutClosed: true,
          stderrClosed: true,
        },
      };
    },
  };
}

describe('C-05 generation execution loop', () => {
  it('저장된 providerId와 정확히 일치하지 않으면 fallback하지 않는다', () => {
    const provider = succeedingTestAdapter();
    const registry = new GenerationProviderRegistry([{
      providerId: 'claude-cli', provider,
    }]);
    expect(() => registry.resolve({
      providerId: 'test', modelChoice: { kind: 'installed_default' },
    })).toThrow(ProviderRegistryError);
    expect(registry.resolve({
      providerId: 'claude-cli', modelChoice: { kind: 'explicit', modelId: 'fixed-model' },
    }).provider).toBe(provider);
  });

  it('명시 test adapter가 M032 pending Run을 claim하고 결과를 저장한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const controller = createGenerationController(app);
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope,
        idempotencyKey: 'generation-loop-red',
        guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      await new Promise((resolve) => setTimeout(resolve, 40));
      const paused = await app.invoke('M-033', fixture.scope, requested.value.runId);
      expect(paused.ok && paused.value.status).toBe('pending');
      const health = () => app.server.inject({
        method: 'GET', url: '/health/ready',
        headers: { host: new URL(app.baseURL).host, origin: app.baseURL },
      }).then((response) => response.json());
      await expect(health())
        .resolves.toMatchObject({ generationReady: false });

      await controller.startTestAdapter(succeedingTestAdapter());
      await expect(health())
        .resolves.toMatchObject({ generationReady: true });

      let status = 'pending';
      for (let attempt = 0; attempt < 80 && (status === 'pending' || status === 'running'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const read = await app.invoke('M-033', fixture.scope, requested.value.runId);
        if (read.ok) status = read.value.status;
      }
      expect(status).toBe('succeeded');
    } finally {
      await controller.stop();
      await app.close();
    }
  });

  it('같은 TestApp에 controller를 중복 등록하지 않는다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      createGenerationController(app);
      expect(() => createGenerationController(app)).toThrow(/이미 등록/u);
    } finally {
      await app.close();
    }
  });

  it('저장된 선택의 adapter가 없으면 실행하지 않고 failed와 종료 관찰을 저장한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const controller = createGenerationController(app);
    let called = false;
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-no-fallback', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      app.db.prepare('UPDATE generation_runs SET provider_selection_json=? WHERE run_id=?').run(
        JSON.stringify({ providerId: 'missing-provider', modelChoice: { kind: 'installed_default' } }),
        requested.value.runId,
      );
      await controller.startTestAdapter({
        async generate() { called = true; throw new Error('fallback adapter가 호출되면 안 됩니다.'); },
      });
      let status = 'pending';
      for (let attempt = 0; attempt < 80 && (status === 'pending' || status === 'running'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const read = await app.invoke('M-033', fixture.scope, requested.value.runId);
        if (read.ok) status = read.value.status;
      }
      expect(called).toBe(false);
      expect(status).toBe('failed');
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM execution_observations WHERE run_id=?',
      ).get(requested.value.runId)).toEqual({ count: 1 });
    } finally {
      await controller.stop();
      await app.close();
    }
  });

  it('adapter 선택 전 Confirmed 관찰의 SQLITE_BUSY도 재시도한 뒤 slot을 해제한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
    const evidence = new ExecutionEvidenceRegistry();
    const baseInternal = createGenerationInternalService({
      persistence: createPersistence(app.db), claims, evidence,
      executionPolicy: app.generationRuntime.executionPolicy,
      draftMaxBytes: app.generationRuntime.draftMaxBytes,
      monotonicClock: { now: () => performance.now() },
    });
    let attempts = 0;
    const internal = {
      ...baseInternal,
      recordExecutionTermination(input: Parameters<typeof baseInternal.recordExecutionTermination>[0]) {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error('synthetic pre-provider observation busy'), { code: 'SQLITE_BUSY' });
        }
        return baseInternal.recordExecutionTermination(input);
      },
    };
    const loop = createGenerationExecutionLoop({
      internal, runtime: claims.runtime, evidence,
      providers: new GenerationProviderRegistry([]),
      runsRoot: app.generationRuntime.runsRoot, controlPollMs: 5,
    });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-pre-provider-busy', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      await loop.start();
      await loop.stop();
      expect(attempts).toBe(2);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM execution_observations WHERE run_id=?',
      ).get(requested.value.runId)).toEqual({ count: 1 });
      expect(app.db.prepare(
        'SELECT run_id FROM execution_slot WHERE singleton_id=1 AND run_id IS NOT NULL',
      ).get()).toBeUndefined();
    } finally {
      await loop.stop().catch(() => undefined);
      const retained = app.db.prepare(
        'SELECT run_id FROM execution_slot WHERE singleton_id=1 AND run_id IS NOT NULL',
      ).get();
      if (retained !== undefined) {
        app.db.prepare(
          `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                  claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
        ).run();
      }
      await app.close();
    }
  });

  it('M034 commit 알림으로 실행 중 adapter의 AbortSignal을 한 번 중단한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const controller = createGenerationController(app);
    let abortCount = 0;
    const provider: GenerationProvider = {
      async generate(request, control) {
        await new Promise<void>((resolve) => {
          control.signal.addEventListener('abort', () => {
            abortCount += 1;
            resolve();
          }, { once: true });
        });
        return {
          kind: 'failed',
          failure: { code: 'CANCELLED', diagnostic: 'test adapter cancellation' },
          execution: {
            providerId: request.selection.providerId,
            profileVersion: control.policy.profileVersion,
            startedAt: '2026-09-09T03:00:00.000Z',
            finishedAt: '2026-09-09T03:00:01.000Z',
            stdoutBytes: 0,
            stderrBytes: 0,
            stdoutClosed: true,
            stderrClosed: true,
          },
        };
      },
    };
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-cancel-request', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      await controller.startTestAdapter(provider);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const read = await app.invoke('M-033', fixture.scope, requested.value.runId);
        if (read.ok && read.value.status === 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const cancelled = await app.invoke('M-034', {
        ...fixture.scope, idempotencyKey: 'generation-cancel',
      }, requested.value.runId);
      expect(cancelled.ok).toBe(true);
      for (let attempt = 0; attempt < 80 && abortCount === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(abortCount).toBe(1);
      const read = await app.invoke('M-033', fixture.scope, requested.value.runId);
      expect(read.ok && read.value.status).toBe('cancelled');
    } finally {
      await controller.stop();
      await app.close();
    }
  });

  it('종료가 Unknown이면 slot과 소유 실행 폴더를 보존한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
    const evidence = new ExecutionEvidenceRegistry();
    const internal = createGenerationInternalService({
      persistence: createPersistence(app.db), claims, evidence,
      executionPolicy: app.generationRuntime.executionPolicy,
      draftMaxBytes: app.generationRuntime.draftMaxBytes,
      monotonicClock: { now: () => performance.now() },
    });
    const provider: GenerationProvider = {
      async generate(request, control) {
        evidence.observer(unknownProcess(control.execution.launchRef, 'execution_scope_not_proven'));
        const outcome = {
          kind: 'failed' as const,
          failure: { code: 'PROCESS_FAILED' as const, diagnostic: '정제된 실행 실패' },
          execution: {
            providerId: request.selection.providerId,
            profileVersion: control.policy.profileVersion,
            startedAt: '2026-09-09T03:00:00.000Z',
            finishedAt: '2026-09-09T03:00:01.000Z',
            exitCode: 1,
            stdoutBytes: 0,
            stderrBytes: 0,
            stdoutClosed: true,
            stderrClosed: true,
          },
        };
        evidence.sink.record(outcome, { kind: 'failure' });
        return outcome;
      },
    };
    const loop = createGenerationExecutionLoop({
      internal, runtime: claims.runtime, evidence,
      providers: new GenerationProviderRegistry([{
        providerId: 'claude-cli', provider,
      }]),
      runsRoot: app.generationRuntime.runsRoot,
      controlPollMs: app.generationRuntime.controlPollMs,
    });
    let closeRejected = false;
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-unknown', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      await loop.start();
      let status = 'pending';
      for (let attempt = 0; attempt < 80 && (status === 'pending' || status === 'running'); attempt += 1) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        const read = await app.invoke('M-033', fixture.scope, requested.value.runId);
        if (read.ok) status = read.value.status;
      }
      await loop.stop();
      expect(status).toBe('failed');
      const slot = app.db.prepare(
        'SELECT run_id,launch_intent_id FROM execution_slot WHERE singleton_id=1',
      ).get() as { readonly run_id: string; readonly launch_intent_id: string };
      expect(slot.run_id).toBe(requested.value.runId);
      await expect(access(resolve(app.generationRuntime.runsRoot, slot.launch_intent_id))).resolves.toBeUndefined();
      await expect(app.close()).rejects.toThrow(/활성 실행 slot|외래 키|FOREIGN/u);
      closeRejected = true;
    } finally {
      if (!closeRejected && app.db.open) await app.close().catch(() => undefined);
      await rm(dirname(app.generationRuntime.runsRoot), { recursive: true, force: true });
    }
  });

  it('신뢰한 완료 시각 뒤 commit 경계 deadline 초과를 TIMEOUT terminal로 저장한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
    const evidence = new ExecutionEvidenceRegistry();
    const internal = createGenerationInternalService({
      persistence: createPersistence(app.db), claims, evidence,
      executionPolicy: app.generationRuntime.executionPolicy,
      draftMaxBytes: app.generationRuntime.draftMaxBytes,
      monotonicClock: { now: () => 101 },
    });
    const provider: GenerationProvider = {
      async generate(request, control) {
        const outcome = await succeedingTestAdapter().generate(request, control);
        evidence.sink.record(outcome, { kind: 'completion', completedAtMono: 50, deadlineMono: 100 });
        evidence.observer({
          kind: 'Confirmed', launchRef: control.execution.launchRef,
          result: { kind: 'no_process_created', evidence: 'in-process deadline fixture' },
        });
        return outcome;
      },
    };
    const loop = createGenerationExecutionLoop({
      internal, runtime: claims.runtime, evidence,
      providers: new GenerationProviderRegistry([{
        providerId: 'claude-cli', provider,
      }]),
      runsRoot: app.generationRuntime.runsRoot,
      controlPollMs: app.generationRuntime.controlPollMs,
    });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-deadline', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      await loop.start();
      let terminal;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const read = await app.invoke('M-033', fixture.scope, requested.value.runId);
        if (read.ok && read.value.status !== 'pending' && read.value.status !== 'running') {
          terminal = read.value;
          break;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
      expect(terminal).toMatchObject({ status: 'failed', error: { code: 'TIMEOUT' } });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM generation_drafts WHERE source_run_id=?',
      ).get(requested.value.runId)).toEqual({ count: 0 });
    } finally {
      await loop.stop();
      await app.close();
    }
  });

  it('TestApp.close가 실행 중 test adapter를 중단하고 observation 저장 뒤 DB를 닫는다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const controller = createGenerationController(app);
    let aborted = 0;
    const fixture = await createGenerationFixture(app);
    const requested = await app.invoke('M-032', {
      ...fixture.scope, idempotencyKey: 'generation-close-drain', guard: fixture.guard,
    }, fixture.input);
    expect(requested.ok).toBe(true);
    if (!requested.ok) {
      await app.close();
      return;
    }
    await controller.startTestAdapter({
      async generate(request, control) {
        await new Promise<void>((resolvePromise) => control.signal.addEventListener('abort', () => {
          aborted += 1;
          resolvePromise();
        }, { once: true }));
        return {
          kind: 'failed',
          failure: { code: 'CANCELLED', diagnostic: 'TestApp close' },
          execution: {
            providerId: request.selection.providerId,
            profileVersion: control.policy.profileVersion,
            startedAt: '2026-09-09T03:00:00.000Z',
            finishedAt: '2026-09-09T03:00:01.000Z',
            stdoutBytes: 0,
            stderrBytes: 0,
            stdoutClosed: true,
            stderrClosed: true,
          },
        };
      },
    });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const read = await app.invoke('M-033', fixture.scope, requested.value.runId);
      if (read.ok && read.value.status === 'running') break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
    await app.close();
    expect(aborted).toBe(1);
    expect(app.db.open).toBe(false);
  });

  it('provider rejection을 unhandled rejection으로 흘리지 않고 stop 오류와 보존 상태로 남긴다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const controller = createGenerationController(app);
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    let closeRejected = false;
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-provider-reject', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      await controller.startTestAdapter({
        async generate() { throw new Error('synthetic provider rejection'); },
      });
      let health;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        health = await app.server.inject({
          method: 'GET', url: '/health/ready',
          headers: { host: new URL(app.baseURL).host, origin: app.baseURL },
        });
        if (health.json().generationReady === false) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
      expect(unhandled).toEqual([]);
      expect(health?.json()).toMatchObject({ generationReady: false });
      expect(app.db.prepare(
        'SELECT status FROM generation_runs WHERE run_id=?',
      ).get(requested.value.runId)).toEqual({ status: 'running' });
      await expect(app.close()).rejects.toThrow(/synthetic provider rejection/u);
      closeRejected = true;
    } finally {
      process.off('unhandledRejection', onUnhandled);
      if (!closeRejected && app.db.open) await app.close().catch(() => undefined);
      await rm(dirname(app.generationRuntime.runsRoot), { recursive: true, force: true });
    }
  });

  it('늦은 Confirmed 관찰의 SQLITE_BUSY를 같은 claim에서 재시도한 뒤 slot을 해제한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
    const evidence = new ExecutionEvidenceRegistry();
    const baseInternal = createGenerationInternalService({
      persistence: createPersistence(app.db), claims, evidence,
      executionPolicy: app.generationRuntime.executionPolicy,
      draftMaxBytes: app.generationRuntime.draftMaxBytes,
      monotonicClock: { now: () => performance.now() },
    });
    let observationAttempts = 0;
    let firstAttempt!: () => void;
    const firstObservationAttempt = new Promise<void>((resolvePromise) => { firstAttempt = resolvePromise; });
    const internal = {
      ...baseInternal,
      recordExecutionTermination(input: Parameters<typeof baseInternal.recordExecutionTermination>[0]) {
        observationAttempts += 1;
        if (observationAttempts === 1) firstAttempt();
        if (observationAttempts === 1) {
          throw Object.assign(new Error('synthetic observation busy'), { code: 'SQLITE_BUSY' });
        }
        return baseInternal.recordExecutionTermination(input);
      },
    };
    const provider: GenerationProvider = {
      async generate(request, control) {
        const outcome = {
          kind: 'failed' as const,
          failure: { code: 'PROCESS_FAILED' as const, diagnostic: 'late observation fixture' },
          execution: {
            providerId: request.selection.providerId,
            profileVersion: control.policy.profileVersion,
            startedAt: '2026-09-09T03:00:00.000Z',
            finishedAt: '2026-09-09T03:00:01.000Z',
            exitCode: 1,
            stdoutBytes: 0,
            stderrBytes: 0,
            stdoutClosed: true,
            stderrClosed: true,
          },
        };
        evidence.sink.record(outcome, { kind: 'failure' });
        setTimeout(() => evidence.observer(noProcessCreated(
          control.execution.launchRef,
          'late confirmed no process fixture',
        )), 20);
        return outcome;
      },
    };
    const loop = createGenerationExecutionLoop({
      internal, runtime: claims.runtime, evidence,
      providers: new GenerationProviderRegistry([{ providerId: 'claude-cli', provider }]),
      runsRoot: app.generationRuntime.runsRoot,
      controlPollMs: 10,
    });
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-observation-retry', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      await loop.start();
      await firstObservationAttempt;
      await loop.stop();
      const slot = app.db.prepare(
        'SELECT run_id FROM execution_slot WHERE singleton_id=1 AND run_id IS NOT NULL',
      ).get();
      expect(observationAttempts).toBe(2);
      expect(slot).toBeUndefined();
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM execution_observations WHERE run_id=?',
      ).get(requested.value.runId)).toEqual({ count: 1 });
    } finally {
      await loop.stop().catch(() => undefined);
      await app.close();
    }
  });

  it('control 조회 실패 뒤 provider를 한 번 중단하고 결과와 Confirmed 관찰을 drain한 뒤 원 오류를 반환한다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
    const evidence = new ExecutionEvidenceRegistry();
    const baseInternal = createGenerationInternalService({
      persistence: createPersistence(app.db), claims, evidence,
      executionPolicy: app.generationRuntime.executionPolicy,
      draftMaxBytes: app.generationRuntime.draftMaxBytes,
      monotonicClock: { now: () => performance.now() },
    });
    const controlError = Object.assign(new Error('synthetic control read busy'), { code: 'SQLITE_BUSY' });
    const internal = { ...baseInternal, readRunControl() { throw controlError; } };
    let aborted = 0;
    let settled = false;
    const provider: GenerationProvider = {
      async generate(request, control) {
        await new Promise<void>((resolvePromise) => control.signal.addEventListener('abort', () => {
          aborted += 1;
          resolvePromise();
        }, { once: true }));
        const outcome = {
          kind: 'failed' as const,
          failure: { code: 'CANCELLED' as const, diagnostic: 'control read failure fixture' },
          execution: {
            providerId: request.selection.providerId,
            profileVersion: control.policy.profileVersion,
            startedAt: '2026-09-09T03:00:00.000Z', finishedAt: '2026-09-09T03:00:01.000Z',
            stdoutBytes: 0, stderrBytes: 0, stdoutClosed: true, stderrClosed: true,
          },
        };
        evidence.sink.record(outcome, { kind: 'failure' });
        evidence.observer(noProcessCreated(control.execution.launchRef, 'control read failure no process fixture'));
        settled = true;
        return outcome;
      },
    };
    let reportFailure!: (error: unknown) => void;
    const failureReported = new Promise<unknown>((resolvePromise) => { reportFailure = resolvePromise; });
    const loop = createGenerationExecutionLoop({
      internal, runtime: claims.runtime, evidence,
      providers: new GenerationProviderRegistry([{ providerId: 'claude-cli', provider }]),
      runsRoot: app.generationRuntime.runsRoot, controlPollMs: 5,
      onFailure: reportFailure,
    });
    let stopRejected = false;
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'generation-control-error-drain', guard: fixture.guard,
      }, fixture.input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      await loop.start();
      await expect(failureReported).resolves.toBe(controlError);
      await expect(loop.stop()).rejects.toBe(controlError);
      stopRejected = true;
      expect({ aborted, settled }).toEqual({ aborted: 1, settled: true });
      expect(app.db.prepare('SELECT count(*) AS count FROM execution_observations WHERE run_id=?')
        .get(requested.value.runId)).toEqual({ count: 1 });
      expect(app.db.prepare('SELECT run_id FROM execution_slot WHERE singleton_id=1 AND run_id IS NOT NULL').get())
        .toBeUndefined();
    } finally {
      if (!stopRejected) await loop.stop().catch(() => undefined);
      await app.close();
    }
  });

  it('즉시 Confirmed 관찰의 SQLITE_BUSY도 재시도하고 영구 실패는 유한 횟수 뒤 보존 오류로 반환한다', async () => {
    for (const persistent of [false, true]) {
      const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
      const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
      const evidence = new ExecutionEvidenceRegistry();
      const baseInternal = createGenerationInternalService({
        persistence: createPersistence(app.db), claims, evidence,
        executionPolicy: app.generationRuntime.executionPolicy,
        draftMaxBytes: app.generationRuntime.draftMaxBytes,
        monotonicClock: { now: () => performance.now() },
      });
      let attempts = 0;
      const internal = {
        ...baseInternal,
        recordExecutionTermination(input: Parameters<typeof baseInternal.recordExecutionTermination>[0]) {
          attempts += 1;
          if (persistent || attempts === 1) {
            throw Object.assign(new Error('synthetic persistent observation busy'), { code: 'SQLITE_BUSY' });
          }
          return baseInternal.recordExecutionTermination(input);
        },
      };
      const provider: GenerationProvider = {
        async generate(request, control) {
          const outcome = await succeedingTestAdapter().generate(request, control);
          evidence.sink.record(outcome, { kind: 'completion', completedAtMono: 50, deadlineMono: 100 });
          evidence.observer(noProcessCreated(control.execution.launchRef, 'immediate confirmed fixture'));
          return outcome;
        },
      };
      const loop = createGenerationExecutionLoop({
        internal, runtime: claims.runtime, evidence,
        providers: new GenerationProviderRegistry([{ providerId: 'claude-cli', provider }]),
        runsRoot: app.generationRuntime.runsRoot, controlPollMs: 5,
      });
      let stopRejected = false;
      try {
        const fixture = await createGenerationFixture(app);
        const requested = await app.invoke('M-032', {
          ...fixture.scope, idempotencyKey: `generation-immediate-busy-${persistent}`, guard: fixture.guard,
        }, fixture.input);
        expect(requested.ok).toBe(true);
        if (!requested.ok) continue;
        await loop.start();
        if (persistent) {
          await expect(loop.stop()).rejects.toThrow('synthetic persistent observation busy');
          stopRejected = true;
          expect(attempts).toBeGreaterThan(1);
          const retained = app.db.prepare(
            'SELECT run_id,launch_intent_id FROM execution_slot WHERE singleton_id=1 AND run_id IS NOT NULL',
          ).get() as { readonly run_id: string; readonly launch_intent_id: string };
          expect(retained.run_id).toBe(requested.value.runId);
          await expect(access(resolve(app.generationRuntime.runsRoot, retained.launch_intent_id)))
            .resolves.toBeUndefined();
        } else {
          await loop.stop();
          expect(attempts).toBe(2);
          expect(app.db.prepare('SELECT count(*) AS count FROM execution_observations WHERE run_id=?')
            .get(requested.value.runId)).toEqual({ count: 1 });
        }
      } finally {
        if (!stopRejected) await loop.stop().catch(() => undefined);
        if (persistent) {
          app.db.prepare(
            `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
                    claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL WHERE singleton_id=1`,
          ).run();
        }
        await app.close();
        await rm(dirname(app.generationRuntime.runsRoot), { recursive: true, force: true });
      }
    }
  });
});
