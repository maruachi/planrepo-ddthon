import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGenerationInternalService } from '@/src/application/generation-internal';
import { ClaimContextAuthority } from '@/src/generation-runtime/claim-context';
import { ExecutionEvidenceRegistry } from '@/src/generation-runtime/execution-evidence-registry';
import { createGenerationExecutionLoop } from '@/src/generation-runtime/execution-loop';
import { createPersistence } from '@/src/persistence/transaction';
import {
  APPROVED_CLAUDE_VERSION,
  CLAUDE_PROFILE_FINGERPRINT,
} from '@/src/providers/generation/claude-profile';
import { GenerationProviderRegistry } from '@/src/providers/generation/provider-registry';
import type { GenerationProvider } from '@/src/providers/generation/provider-contract';
import {
  RestrictedProcessRunner,
  verifyRestrictedProcessSupport,
} from '@/src/runtime/restricted-process-runner';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

describe('restricted process generation loop', () => {
  it('stores M-050 after the restricted scope closes and accepts the next generation', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    const workRoot = await mkdtemp(join(tmpdir(), 'planrepo-restricted-loop-'));
    let loop: ReturnType<typeof createGenerationExecutionLoop> | undefined;
    try {
      const fixture = await createGenerationFixture(app);
      const requested = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'restricted-loop-first', guard: fixture.guard,
      }, fixture.input);
      if (!requested.ok) throw new Error(requested.error.code);
      const verified = await verifyRestrictedProcessSupport({
        projectRoot: process.cwd(), workRoot,
        claudeProfileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
        cliVersion: APPROVED_CLAUDE_VERSION,
      });
      if (verified.kind !== 'Supported') throw new Error(verified.reason);
      const runner = new RestrictedProcessRunner(verified.capability);
      const evidence = new ExecutionEvidenceRegistry();
      const claims = new ClaimContextAuthority(app.generationRuntime.runtimeId);
      const internal = createGenerationInternalService({
        persistence: createPersistence(app.db), claims, evidence,
        executionPolicy: app.generationRuntime.executionPolicy,
        draftMaxBytes: app.generationRuntime.draftMaxBytes,
        monotonicClock: { now: () => performance.now() },
      });
      const provider: GenerationProvider = {
        async generate(request, control) {
          const execution = runner.start({
            executable: process.execPath,
            args: ['-e', 'process.stdout.write("restricted-generation")'],
            cwd: control.execution.cwd,
            env: {},
            stdinBytes: Buffer.alloc(0),
            launchRef: control.execution.launchRef,
            limits: {
              stdinMaxBytes: 1024,
              stdoutMaxBytes: control.policy.stdoutMaxBytes,
              stderrMaxBytes: control.policy.stderrMaxBytes,
              timeoutMs: control.policy.timeoutMs,
              terminationGraceMs: 500,
            },
          }, evidence.observer);
          const processResult = await execution.result;
          if (processResult.kind !== 'Completed') throw new Error(processResult.code);
          const outcome = {
            kind: 'completed' as const,
            result: {
              schemaVersion: 1 as const,
              kind: 'question_proposals' as const,
              proposals: [{
                temporaryId: 'restricted-question',
                text: '제한 실행 종료 뒤 후속 생성을 시작할 수 있습니까?',
                reason: 'M-050 slot 해제를 검증합니다.',
                suggestedAssigneeId: 'persona-p01-owner',
                requiredGate: 'G1' as const,
                sourceRefs: [], candidateAnswers: [],
              }] as const,
            },
            execution: {
              providerId: request.selection.providerId,
              actualModelId: 'restricted-node-fixture',
              cliVersion: 'test-only',
              profileVersion: control.policy.profileVersion,
              ...processResult.metrics,
              exitCode: 0 as const,
            },
          };
          evidence.sink.record(outcome, {
            kind: 'completion',
            completedAtMono: processResult.closedAtMono,
            deadlineMono: processResult.deadlineMono,
          });
          return outcome;
        },
      };
      loop = createGenerationExecutionLoop({
        internal, runtime: claims.runtime,
        providers: new GenerationProviderRegistry([{ providerId: 'claude-cli', provider }]),
        evidence,
        runsRoot: app.generationRuntime.runsRoot,
        controlPollMs: 10,
      });
      await loop.start();
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (readGenerationState(app.db, requested.value.runId).observations.length === 1) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
      const state = readGenerationState(app.db, requested.value.runId);
      expect(state.runs[0]?.status).toBe('succeeded');
      expect(state.activeSlot).toBeUndefined();
      expect(state.observations).toHaveLength(1);
      const storedObservation = app.db.prepare(
        'SELECT termination_result_json FROM execution_observations WHERE run_id=?',
      ).get(requested.value.runId) as { readonly termination_result_json: string };
      expect(JSON.parse(storedObservation.termination_result_json)).toEqual({
        kind: 'restricted_scope_exited',
        scopePolicyRef: verified.capability.scopePolicyRef,
        exitCode: 0,
      });
      const followup = await app.invoke('M-032', {
        ...fixture.scope, idempotencyKey: 'restricted-loop-followup', guard: fixture.guard,
      }, fixture.input);
      expect(followup).toMatchObject({ ok: true, disposition: 'Committed' });
    } finally {
      await loop?.stop();
      await app.close();
      await rm(workRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
