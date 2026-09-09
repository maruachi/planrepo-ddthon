import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { GenerationProvider } from '@/src/providers/generation/provider-contract';
import { createGenerationController } from '@/tests/helpers/generation-controller';
import { createGenerationFixture } from '@/tests/helpers/generation-fixture';
import { createTestApp } from '@/tests/helpers/test-app';

async function waitForTerminal(
  app: Awaited<ReturnType<typeof createTestApp>>,
  scope: Awaited<ReturnType<typeof createGenerationFixture>>['scope'],
  runId: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const read = await app.invoke('M-033', scope, runId);
    if (read.ok && read.value.status !== 'pending' && read.value.status !== 'running') return read.value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('generation terminal 결과를 기다리는 시간이 초과됐습니다.');
}

function adapter(outcome: 'success' | 'failure'): GenerationProvider {
  return {
    async generate(request, control) {
      const execution = {
        providerId: request.selection.providerId,
        profileVersion: control.policy.profileVersion,
        startedAt: '2026-09-09T04:00:00.000Z',
        finishedAt: '2026-09-09T04:00:01.000Z',
        exitCode: outcome === 'success' ? 0 : 1,
        stdoutBytes: outcome === 'success' ? 128 : 0,
        stderrBytes: 0,
        stdoutClosed: true,
        stderrClosed: true,
      };
      return outcome === 'success'
        ? {
            kind: 'completed' as const,
            result: {
              schemaVersion: 1 as const,
              kind: 'question_proposals' as const,
              proposals: [{
                temporaryId: 'provider-swap-question',
                text: '교체 가능한 adapter 결과입니까?',
                reason: '동일 저장 계약을 확인합니다.',
                suggestedAssigneeId: 'persona-p01-owner',
                requiredGate: 'G1' as const,
                sourceRefs: [],
                candidateAnswers: [],
              }],
            },
            execution,
          }
        : {
            kind: 'failed' as const,
            failure: { code: 'PROVIDER_ERROR' as const, diagnostic: '정제된 test provider 실패' },
            execution,
          };
    },
  };
}

describe('stored provider selection adapter swap', () => {
  it.each(['success', 'failure'] as const)(
    '고정 selection을 바꾸지 않고 %s adapter 결과를 같은 Run 계약에 저장한다',
    async (outcome) => {
      const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
      const controller = createGenerationController(app);
      try {
        const fixture = await createGenerationFixture(app);
        const requested = await app.invoke('M-032', {
          ...fixture.scope,
          idempotencyKey: `provider-swap-${outcome}`,
          guard: fixture.guard,
        }, fixture.input);
        expect(requested.ok).toBe(true);
        if (!requested.ok) return;
        const storedBefore = app.db.prepare(
          'SELECT provider_selection_json FROM generation_runs WHERE run_id=?',
        ).get(requested.value.runId) as { readonly provider_selection_json: string };

        await controller.startTestAdapter(adapter(outcome));
        const terminal = await waitForTerminal(app, fixture.scope, requested.value.runId);
        const storedAfter = app.db.prepare(
          'SELECT provider_selection_json FROM generation_runs WHERE run_id=?',
        ).get(requested.value.runId) as { readonly provider_selection_json: string };

        expect(terminal.status).toBe(outcome === 'success' ? 'succeeded' : 'failed');
        expect(storedAfter.provider_selection_json).toBe(storedBefore.provider_selection_json);
        expect(JSON.stringify(terminal)).not.toMatch(/ownershipToken|claimToken|environment/u);
      } finally {
        await controller.stop();
        await app.close();
      }
    },
  );
});
