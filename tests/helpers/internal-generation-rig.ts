import type { ClaimRef, RuntimeContext, SrScope } from '@/src/contracts/context';
import { createGenerationInternalService } from '@/src/application/generation-internal';
import type {
  CompletionTimingEvidence,
  InternalExecutionEvidencePort,
} from '@/src/generation-runtime/execution-evidence';
import { ClaimContextAuthority } from '@/src/generation-runtime/claim-context';
import type {
  ClaimedRun,
  ExecutionReport,
  ExecutionTermination,
  GenerationResult,
  ProviderCompletion,
  ProviderFailure,
  ProviderFailureCore,
  RunCompletionOutcome,
  RunControlView,
  ExecutionObservation,
} from '@/src/contracts/views';
import { createPersistence } from '@/src/persistence/transaction';
import { CLAUDE_PROFILE_VERSION } from '@/src/providers/generation/claude-result';
import { loadRuntimeConfig } from '@/src/runtime/config';
import type { TestApp } from '@/tests/helpers/test-app';

export interface ClaimHandle {
  readonly runId: string;
  readonly claimId: string;
}

interface ClaimAssociation {
  readonly claimed: ClaimedRun;
  readonly completionEvidence: WeakMap<ProviderCompletion, CompletionTimingEvidence>;
  readonly failureEvidence: WeakSet<ProviderFailure>;
  readonly terminationEvidence: WeakSet<ExecutionTermination>;
}

const associations = new WeakMap<ClaimHandle, ClaimAssociation>();

function association(handle: ClaimHandle): ClaimAssociation {
  const value = associations.get(handle);
  if (value === undefined) throw new Error('이 rig가 발급하지 않은 ClaimHandle입니다.');
  return value;
}

function executionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    providerId: 'test',
    actualModelId: 'test-model-confirmed',
    cliVersion: 'test-cli-1',
    profileVersion: CLAUDE_PROFILE_VERSION,
    startedAt: '2026-09-09T03:00:00.000Z',
    finishedAt: '2026-09-09T03:00:01.000Z',
    exitCode: 0,
    stdoutBytes: 128,
    stderrBytes: 0,
    stdoutClosed: true,
    stderrClosed: true,
    ...overrides,
  };
}

export function createInternalGenerationRig(app: TestApp, runtimeId?: string) {
  const runtime = app.db.prepare(
    runtimeId === undefined
      ? 'SELECT runtime_id FROM runtime_instances ORDER BY runtime_id LIMIT 1'
      : 'SELECT runtime_id FROM runtime_instances WHERE runtime_id=?',
  ).get(...(runtimeId === undefined ? [] : [runtimeId])) as {
    readonly runtime_id: string;
  } | undefined;
  if (runtime === undefined) throw new Error('TestApp runtime이 등록되지 않았습니다.');
  const claims = new ClaimContextAuthority(runtime.runtime_id);
  const completionEvidence = new WeakMap<ProviderCompletion, CompletionTimingEvidence>();
  const failureEvidence = new WeakSet<ProviderFailure>();
  const terminationEvidence = new WeakSet<ExecutionTermination>();
  const evidence: InternalExecutionEvidencePort = {
    completion: (input) => completionEvidence.get(input),
    failure: (input) => failureEvidence.has(input),
    termination: (input) => terminationEvidence.has(input),
  };
  let monotonicNow = 50;
  const config = loadRuntimeConfig(process.cwd(), {
    PLANREPO_MODE: 'test', PLANREPO_TEST_RUN_ID: 'internal-generation-rig',
  });
  const service = createGenerationInternalService({
    persistence: createPersistence(app.db),
    claims,
    evidence,
    executionPolicy: {
      profileVersion: CLAUDE_PROFILE_VERSION,
      timeoutMs: 300_000,
      stdoutMaxBytes: 4_194_304,
      stderrMaxBytes: 262_144,
      normalizedResultMaxBytes: 2_097_152,
    },
    draftMaxBytes: config.limits.draftBytes,
    monotonicClock: { now: () => monotonicNow },
    now: () => '2026-09-09T03:00:00.000Z',
  });

  const claimWithRuntime = (runtimeContext: RuntimeContext): ClaimHandle | null => {
    const claimed = service.claimRun(runtimeContext);
    if (claimed === null) return null;
    const handle = Object.freeze({
      runId: claimed.claimRef.runId,
      claimId: claimed.claimRef.claimId,
    });
    associations.set(handle, { claimed, completionEvidence, failureEvidence, terminationEvidence });
    return handle;
  };

  return {
    async claim(): Promise<ClaimHandle | null> {
      return claimWithRuntime(claims.runtime);
    },
    async claimWithRuntime(runtimeContext: RuntimeContext): Promise<ClaimHandle | null> {
      return claimWithRuntime(runtimeContext);
    },
    async complete(
      handle: ClaimHandle,
      draft: GenerationResult,
      options: {
        readonly completedAtMono?: number;
        readonly deadlineMono?: number;
        readonly execution?: Partial<ExecutionReport>;
        readonly claimRef?: ClaimRef;
      } = {},
    ): Promise<RunCompletionOutcome> {
      const value = association(handle);
      const input: ProviderCompletion = {
        claimRef: options.claimRef ?? value.claimed.claimRef,
        result: draft,
        execution: executionReport({
          providerId: value.claimed.selection.providerId,
          profileVersion: value.claimed.executionPolicy.profileVersion,
          ...options.execution,
        }),
      };
      completionEvidence.set(input, {
        completedAtMono: options.completedAtMono ?? 40,
        deadlineMono: options.deadlineMono ?? 100,
      });
      return service.completeRun(input);
    },
    async fail(
      handle: ClaimHandle,
      failure: ProviderFailureCore = { code: 'PROVIDER_ERROR', diagnostic: 'test failure' },
      execution: Partial<ExecutionReport> = { exitCode: 1 },
    ): Promise<RunCompletionOutcome> {
      const value = association(handle);
      const input: ProviderFailure = {
        claimRef: value.claimed.claimRef,
        failure,
        execution: executionReport({
          providerId: value.claimed.selection.providerId,
          profileVersion: value.claimed.executionPolicy.profileVersion,
          ...execution,
        }),
      };
      failureEvidence.add(input);
      return service.failRun(input);
    },
    async control(handle: ClaimHandle): Promise<RunControlView> {
      return service.readRunControl(association(handle).claimed.claimRef);
    },
    async controlWithClaimRef(claimRef: ClaimRef): Promise<RunControlView> {
      return service.readRunControl(claimRef);
    },
    async observe(handle: ClaimHandle, input: ExecutionTermination): Promise<ExecutionObservation> {
      if (input.claimRef !== association(handle).claimed.claimRef) {
        throw new Error('종료 fixture의 claim이 handle과 다릅니다.');
      }
      return service.recordExecutionTermination(input);
    },
    setMonotonicNow(value: number): void {
      monotonicNow = value;
    },
    unsafeClaimRef(handle: ClaimHandle): ClaimRef {
      return association(handle).claimed.claimRef;
    },
    unsafeRuntimeContext(): RuntimeContext {
      return claims.runtime;
    },
    scope(handle: ClaimHandle): SrScope {
      return association(handle).claimed.snapshot.scope;
    },
  };
}

export function validDraft(_claim: ClaimHandle): GenerationResult {
  return {
    schemaVersion: 1,
    kind: 'question_proposals',
    proposals: [{
      temporaryId: 'proposal-1',
      text: '확인이 필요한 내용은 무엇인가요?',
      reason: '요구사항의 검증 가능한 범위를 확인합니다.',
      suggestedAssigneeId: 'persona-p01-owner',
      requiredGate: 'G1',
      sourceRefs: [],
      candidateAnswers: [],
    }],
  };
}

export function terminationFixture(
  handle: ClaimHandle,
  evidence: { readonly kind: 'confirmed_test_child_close' | 'no_process_created' },
): ExecutionTermination {
  const value = association(handle);
  const result: ExecutionTermination['result'] = evidence.kind === 'no_process_created'
    ? { kind: 'no_process_created', evidence: 'test port confirmed spawn was not attempted' }
    : { kind: 'exited', exitCode: 0 };
  const input: ExecutionTermination = Object.freeze({
    claimRef: value.claimed.claimRef,
    observedAt: '2026-09-09T03:00:02.000Z',
    result,
    diagnostic: evidence.kind,
  });
  value.terminationEvidence.add(input);
  return input;
}
