import type { RuntimeContext } from '@/src/contracts/context';
import type { ProviderFailure } from '@/src/contracts/views';
import {
  GenerationInternalError,
  type GenerationInternalService,
} from '@/src/application/generation-internal';
import type { CancellationNotificationPort } from '@/src/application/generation-service';
import type { ProviderRequest } from '@/src/providers/generation/provider-contract';
import { GenerationProviderRegistry } from '@/src/providers/generation/provider-registry';
import { noProcessCreated } from '@/src/runtime/process-evidence';
import { ExecutionEvidenceRegistry } from './execution-evidence-registry';
import { createOwnedRunDirectory, type OwnedRunDirectory } from './owned-run-directory';

export interface GenerationExecutionLoopDependencies {
  readonly internal: GenerationInternalService;
  readonly runtime: RuntimeContext;
  readonly providers: GenerationProviderRegistry;
  readonly evidence: ExecutionEvidenceRegistry;
  readonly runsRoot: string;
  readonly controlPollMs: number;
  readonly now?: () => string;
  readonly canClaim?: () => boolean;
  readonly recoveryBeforeClaims?: () => Promise<void>;
  readonly onFailure?: (error: unknown) => void;
}

export interface GenerationExecutionLoop extends CancellationNotificationPort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function providerRequest(claimed: NonNullable<ReturnType<GenerationInternalService['claimRun']>>): ProviderRequest {
  return {
    schemaVersion: 1,
    taskKind: claimed.snapshot.taskKind,
    ...(claimed.snapshot.documentKind === undefined ? {} : { documentKind: claimed.snapshot.documentKind }),
    snapshot: claimed.snapshot,
    selection: claimed.selection,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TERMINATION_BUSY_ATTEMPTS = 3;
const CLAIM_BUSY_ATTEMPTS = 3;

function isSqliteBusy(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'SQLITE_BUSY';
}

export function createGenerationExecutionLoop(
  dependencies: GenerationExecutionLoopDependencies,
): GenerationExecutionLoop {
  const now = dependencies.now ?? (() => new Date().toISOString());
  let started = false;
  let stopping = false;
  let worker: Promise<void> | undefined;
  let workerFailure: unknown;
  let observationFailure: unknown;
  let currentRunId: string | undefined;
  let currentAbort: AbortController | undefined;
  let cancellationWake: (() => void) | undefined;
  const observationAbort = new AbortController();
  const observationTasks = new Set<Promise<void>>();
  const reportFailure = (error: unknown) => {
    try { dependencies.onFailure?.(error); } catch { /* Preserve the original loop failure. */ }
  };

  const storeConfirmedTermination = async (
    launchIntentId: string,
    termination: NonNullable<ReturnType<ExecutionEvidenceRegistry['confirmedTermination']>>,
    directory?: OwnedRunDirectory,
  ): Promise<void> => {
    for (let attempt = 1; attempt <= TERMINATION_BUSY_ATTEMPTS; attempt += 1) {
      try {
        dependencies.internal.recordExecutionTermination(termination);
        dependencies.evidence.confirmTerminationStored(launchIntentId);
        await directory?.removeAfterConfirmedTermination();
        return;
      } catch (error) {
        if (!isSqliteBusy(error) || attempt === TERMINATION_BUSY_ATTEMPTS) throw error;
        await delay(dependencies.controlPollMs);
      }
    }
  };

  const waitForControlPoll = async (): Promise<void> => {
    await Promise.race([
      delay(dependencies.controlPollMs),
      new Promise<void>((resolve) => { cancellationWake = resolve; }),
    ]);
    cancellationWake = undefined;
  };

  const executeClaim = async (
    claimed: NonNullable<ReturnType<GenerationInternalService['claimRun']>>,
  ): Promise<void> => {
    const context = dependencies.internal.readClaimExecution(claimed.claimRef);
    dependencies.evidence.bindLaunch(context.launchIntentId, claimed.claimRef);
    let selected: ReturnType<GenerationProviderRegistry['resolve']>;
    try {
      selected = dependencies.providers.resolve(claimed.selection);
    } catch {
      dependencies.evidence.observer(noProcessCreated(
        context.launchIntentId,
        'stored_provider_selection_unavailable_before_spawn',
      ));
      const at = now();
      const outcome = {
        kind: 'failed' as const,
        failure: { code: 'UNAVAILABLE' as const, diagnostic: '저장된 provider 선택을 사용할 수 없습니다.' },
        execution: {
          providerId: claimed.selection.providerId,
          profileVersion: claimed.executionPolicy.profileVersion,
          startedAt: at,
          finishedAt: at,
          stdoutBytes: 0,
          stderrBytes: 0,
          stdoutClosed: false,
          stderrClosed: false,
        },
      };
      dependencies.evidence.sink.record(outcome, { kind: 'failure' });
      const failure: ProviderFailure = { claimRef: claimed.claimRef, failure: outcome.failure, execution: outcome.execution };
      dependencies.evidence.bindFailure(outcome, failure);
      dependencies.internal.failRun(failure);
      const termination = dependencies.evidence.confirmedTermination(context.launchIntentId, now());
      if (termination !== undefined) {
        await storeConfirmedTermination(context.launchIntentId, termination);
      }
      return;
    }
    const request = providerRequest(claimed);
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 2_097_152) {
      dependencies.evidence.observer(noProcessCreated(
        context.launchIntentId,
        'serialized_provider_request_exceeded_limit_before_spawn',
      ));
      const at = now();
      const outcome = {
        kind: 'failed' as const,
        failure: { code: 'POLICY_CONFLICT' as const, diagnostic: '고정 provider 요청이 실행 한도를 넘습니다.' },
        execution: {
          providerId: claimed.selection.providerId,
          profileVersion: claimed.executionPolicy.profileVersion,
          startedAt: at,
          finishedAt: at,
          stdoutBytes: 0,
          stderrBytes: 0,
          stdoutClosed: false,
          stderrClosed: false,
        },
      };
      dependencies.evidence.sink.record(outcome, { kind: 'failure' });
      const failure: ProviderFailure = { claimRef: claimed.claimRef, failure: outcome.failure, execution: outcome.execution };
      dependencies.evidence.bindFailure(outcome, failure);
      dependencies.internal.failRun(failure);
      const termination = dependencies.evidence.confirmedTermination(context.launchIntentId, now());
      if (termination !== undefined) {
        await storeConfirmedTermination(context.launchIntentId, termination);
      }
      return;
    }
    let directory: OwnedRunDirectory;
    try {
      directory = await createOwnedRunDirectory(dependencies.runsRoot, context.launchIntentId);
    } catch {
      dependencies.evidence.observer(noProcessCreated(
        context.launchIntentId,
        'owned_run_directory_not_created',
      ));
      const at = now();
      const outcome = {
        kind: 'failed' as const,
        failure: { code: 'POLICY_CONFLICT' as const, diagnostic: '소유 실행 폴더를 만들지 못했습니다.' },
        execution: {
          providerId: claimed.selection.providerId,
          profileVersion: claimed.executionPolicy.profileVersion,
          startedAt: at,
          finishedAt: at,
          stdoutBytes: 0,
          stderrBytes: 0,
          stdoutClosed: false,
          stderrClosed: false,
        },
      };
      dependencies.evidence.sink.record(outcome, { kind: 'failure' });
      const failure: ProviderFailure = {
        claimRef: claimed.claimRef,
        failure: outcome.failure,
        execution: outcome.execution,
      };
      dependencies.evidence.bindFailure(outcome, failure);
      dependencies.internal.failRun(failure);
      const termination = dependencies.evidence.confirmedTermination(context.launchIntentId, now());
      if (termination !== undefined) {
        await storeConfirmedTermination(context.launchIntentId, termination);
      }
      return;
    }

    const abort = new AbortController();
    currentAbort = abort;
    const outcomePromise = selected.provider.generate(request, {
      signal: abort.signal,
      policy: claimed.executionPolicy,
      execution: { launchRef: context.launchIntentId, cwd: directory.path },
    });
    let settled = false;
    void outcomePromise.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    let controlFailure: unknown;
    try {
      while (!settled && !stopping) {
        await waitForControlPoll();
        if (dependencies.internal.readRunControl(claimed.claimRef).cancelRequested && !abort.signal.aborted) {
          abort.abort();
        }
      }
    } catch (error) {
      controlFailure = error;
      if (!abort.signal.aborted) abort.abort();
    }
    if (stopping && !abort.signal.aborted) abort.abort();
    let outcome;
    try {
      outcome = await outcomePromise;
    } catch (error) {
      throw controlFailure ?? error;
    }
    try {
      if (outcome.kind === 'completed') {
        const completion = {
          claimRef: claimed.claimRef,
          result: outcome.result,
          execution: outcome.execution,
        };
        dependencies.evidence.bindCompletion(outcome, completion);
        try {
          dependencies.internal.completeRun(completion);
        } catch (error) {
          if (!(error instanceof GenerationInternalError) || error.code !== 'DEADLINE_EXCEEDED') throw error;
          const timeout: ProviderFailure = {
            claimRef: claimed.claimRef,
            failure: { code: 'TIMEOUT', diagnostic: '검증된 monotonic deadline을 넘었습니다.' },
            execution: outcome.execution,
          };
          dependencies.evidence.bindDeadlineFailure(outcome, timeout);
          dependencies.internal.failRun(timeout);
        }
      } else {
        const failure: ProviderFailure = {
          claimRef: claimed.claimRef,
          failure: outcome.failure,
          execution: outcome.execution,
        };
        dependencies.evidence.bindFailure(outcome, failure);
        dependencies.internal.failRun(failure);
      }

      const termination = dependencies.evidence.confirmedTermination(context.launchIntentId, now());
      if (termination === undefined) {
        const task = dependencies.evidence.waitForConfirmedTermination(
          context.launchIntentId,
          now,
          observationAbort.signal,
        ).then(async (lateTermination) => {
          if (lateTermination === undefined) return;
          try {
            await storeConfirmedTermination(context.launchIntentId, lateTermination, directory);
          } catch (error) {
            observationFailure ??= error;
            reportFailure(error);
          }
        });
        observationTasks.add(task);
        void task.then(
          () => observationTasks.delete(task),
          () => observationTasks.delete(task),
        );
      } else {
        await storeConfirmedTermination(context.launchIntentId, termination, directory);
      }
    } catch (error) {
      throw controlFailure ?? error;
    }
    currentAbort = undefined;
    if (controlFailure !== undefined) throw controlFailure;
  };

  const run = async () => {
    let claimBusyAttempts = 0;
    while (!stopping) {
      if (dependencies.canClaim !== undefined && !dependencies.canClaim()) {
        await delay(Math.min(dependencies.controlPollMs, 25));
        continue;
      }
      let claimed: ReturnType<GenerationInternalService['claimRun']>;
      try {
        claimed = dependencies.internal.claimRun(dependencies.runtime);
        claimBusyAttempts = 0;
      } catch (error) {
        if (isSqliteBusy(error) && claimBusyAttempts + 1 < CLAIM_BUSY_ATTEMPTS) {
          claimBusyAttempts += 1;
          await delay(dependencies.controlPollMs);
          continue;
        }
        throw error;
      }
      if (claimed === null) {
        await delay(Math.min(dependencies.controlPollMs, 25));
        continue;
      }
      currentRunId = claimed.claimRef.runId;
      try {
        await executeClaim(claimed);
      } finally {
        currentRunId = undefined;
        currentAbort = undefined;
      }
    }
  };

  return {
    async start() {
      if (started) throw new Error('generation execution loop가 이미 시작됐습니다.');
      started = true;
      stopping = false;
      await dependencies.recoveryBeforeClaims?.();
      worker = run().catch((error: unknown) => {
        workerFailure ??= error;
        stopping = true;
        reportFailure(error);
      });
    },
    notifyCancellation(_scope, runId) {
      if (runId === currentRunId) cancellationWake?.();
    },
    async stop() {
      if (!started) return;
      stopping = true;
      currentAbort?.abort();
      cancellationWake?.();
      await worker;
      observationAbort.abort();
      await Promise.all(observationTasks);
      if (workerFailure !== undefined) throw workerFailure;
      if (observationFailure !== undefined) throw observationFailure;
    },
  };
}
