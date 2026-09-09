import type { GenerationProvider } from '@/src/providers/generation/provider-contract';
import type { TestApp } from '@/tests/helpers/test-app';
import { createGenerationInternalService } from '@/src/application/generation-internal';
import { ClaimContextAuthority } from '@/src/generation-runtime/claim-context';
import { ExecutionEvidenceRegistry } from '@/src/generation-runtime/execution-evidence-registry';
import { createGenerationExecutionLoop } from '@/src/generation-runtime/execution-loop';
import { GenerationProviderRegistry } from '@/src/providers/generation/provider-registry';
import { createPersistence } from '@/src/persistence/transaction';
import { noProcessCreated } from '@/src/runtime/process-evidence';
import {
  isClaudeLiveCandidate,
  type ClaudeLiveCandidate,
} from '@/src/runtime/claude-live-candidate';

export interface GenerationController {
  startTestAdapter(provider: GenerationProvider): Promise<void>;
  startLiveCandidate(candidate: ClaudeLiveCandidate): Promise<void>;
  stop(): Promise<void>;
}

export function createGenerationController(app: TestApp): GenerationController {
  const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
  const evidence = new ExecutionEvidenceRegistry();
  const internal = createGenerationInternalService({
    persistence: createPersistence(app.db),
    claims,
    evidence,
    executionPolicy: app.generationRuntime.executionPolicy,
    draftMaxBytes: app.generationRuntime.draftMaxBytes,
    monotonicClock: { now: () => performance.now() },
  });
  let loop: ReturnType<typeof createGenerationExecutionLoop> | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    app.setGenerationReadyForController(false);
    await loop?.stop();
  };
  const controller: GenerationController = {
    async startTestAdapter(provider) {
      if (loop !== undefined) throw new Error('generation controller가 이미 시작됐습니다.');
      const testAdapter: GenerationProvider = {
        async generate(request, control) {
          const startedAtMono = performance.now();
          const outcome = await provider.generate(request, control);
          const completedAtMono = performance.now();
          evidence.sink.record(
            outcome,
            outcome.kind === 'completed'
              ? {
                  kind: 'completion', completedAtMono,
                  deadlineMono: startedAtMono + control.policy.timeoutMs,
                }
              : { kind: 'failure' },
          );
          evidence.observer(noProcessCreated(
            control.execution.launchRef,
            'test_in_process_adapter_created_no_process',
          ));
          return outcome;
        },
      };
      loop = createGenerationExecutionLoop({
        internal,
        runtime: claims.runtime,
        providers: new GenerationProviderRegistry([{
          providerId: app.generationRuntime.providerId,
          provider: testAdapter,
        }]),
        evidence,
        runsRoot: app.generationRuntime.runsRoot,
        controlPollMs: app.generationRuntime.controlPollMs,
        onFailure: () => app.setGenerationReadyForController(false),
      });
      await loop.start();
      app.setGenerationReadyForController(true);
    },
    async startLiveCandidate(candidate) {
      if (loop !== undefined) throw new Error('generation controller가 이미 시작됐습니다.');
      if (!isClaudeLiveCandidate(candidate)) {
        throw new Error('검증되지 않은 Claude live candidate입니다.');
      }
      const provider = candidate.createProvider({
        observer: evidence.observer,
        evidenceSink: evidence.sink,
      });
      loop = createGenerationExecutionLoop({
        internal,
        runtime: claims.runtime,
        providers: new GenerationProviderRegistry([{
          providerId: app.generationRuntime.providerId,
          provider,
        }]),
        evidence,
        runsRoot: app.generationRuntime.runsRoot,
        controlPollMs: app.generationRuntime.controlPollMs,
        onFailure: () => app.setGenerationReadyForController(false),
      });
      await loop.start();
      app.setGenerationReadyForController(true);
    },
    stop,
  };
  app.registerGenerationController(stop, {
    notifyCancellation(scope, runId) {
      return loop?.notifyCancellation(scope, runId);
    },
  });
  return controller;
}
