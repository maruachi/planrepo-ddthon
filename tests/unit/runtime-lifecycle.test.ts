import { describe, expect, it } from 'vitest';
import { createGenerationRuntimeLifecycle } from '@/src/generation-runtime/runtime-lifecycle';

const runtime = { runtimeId: 'runtime-current', ownershipCapability: 'private-capability' };

describe('generation runtime recovery lifecycle', () => {
  it('enables claims only after a recovery result without unresolved slot', async () => {
    const lifecycle = createGenerationRuntimeLifecycle({
      runtime,
      internal: {
        async reconcileInterruptedRuns() {
          return {
            classification: 'PreservedTerminal', goalMet: true,
            reason: 'no slot', inspectedCount: 0,
            recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: [],
            unresolvedRuntimeIds: [],
            recoveryPolicyRef: 'runtime-recovery-v1',
          };
        },
      },
    });
    expect(lifecycle.canClaim()).toBe(false);
    await lifecycle.recoverBeforeClaims();
    expect(lifecycle.canClaim()).toBe(true);
    lifecycle.blockClaims();
    expect(lifecycle.canClaim()).toBe(false);
  });

  it('keeps claims blocked for unknown recovery and when recovery throws', async () => {
    const unknown = createGenerationRuntimeLifecycle({
      runtime,
      internal: {
        async reconcileInterruptedRuns() {
          return {
            classification: 'Unknown', goalMet: false,
            reason: 'strong identity unavailable', inspectedCount: 1,
            recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: ['run-1'],
            unresolvedRuntimeIds: ['runtime-old'],
            recoveryPolicyRef: 'runtime-recovery-v1',
          };
        },
      },
    });
    await unknown.recoverBeforeClaims();
    expect(unknown.canClaim()).toBe(false);

    const failed = createGenerationRuntimeLifecycle({
      runtime,
      internal: { async reconcileInterruptedRuns() { throw new Error('storage unavailable'); } },
    });
    await expect(failed.recoverBeforeClaims()).rejects.toThrow('storage unavailable');
    expect(failed.canClaim()).toBe(false);
  });
});
