import type { RuntimeContext } from '@/src/contracts/context';
import type { GenerationInternalService } from '@/src/application/generation-internal';
import type { RuntimeRecoverySummary } from './recovery';

export interface GenerationRuntimeLifecycle {
  recoverBeforeClaims(): Promise<void>;
  canClaim(): boolean;
  blockClaims(): void;
  recoverySummary(): RuntimeRecoverySummary | undefined;
}

export function createGenerationRuntimeLifecycle(input: {
  readonly internal: Pick<GenerationInternalService, 'reconcileInterruptedRuns'>;
  readonly runtime: RuntimeContext;
}): GenerationRuntimeLifecycle {
  let claimsAllowed = false;
  let recovered = false;
  let lastSummary: RuntimeRecoverySummary | undefined;
  return {
    async recoverBeforeClaims() {
      if (recovered) return;
      claimsAllowed = false;
      lastSummary = await input.internal.reconcileInterruptedRuns(input.runtime);
      recovered = true;
      claimsAllowed = lastSummary.unresolvedRunIds.length === 0 &&
        lastSummary.unresolvedRuntimeIds.length === 0;
    },
    canClaim() { return claimsAllowed; },
    blockClaims() { claimsAllowed = false; },
    recoverySummary() { return lastSummary; },
  };
}
