import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ClaimRef, RuntimeContext } from '@/src/contracts/context';

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export interface IssuedClaimCapability {
  readonly claimRef: ClaimRef;
  readonly tokenHash: string;
}

export interface StoredClaimAuthority {
  readonly runId: string;
  readonly claimId: string;
  readonly ownerRuntimeId: string;
  readonly tokenHash: string;
}

export class ClaimContextAuthority {
  readonly runtime: RuntimeContext;

  constructor(runtimeId: string) {
    if (runtimeId.length === 0) throw new Error('runtime ID가 비었습니다.');
    this.runtime = Object.freeze({
      runtimeId,
      ownershipCapability: randomBytes(32).toString('base64url'),
    });
  }

  verifyRuntime(runtime: RuntimeContext): boolean {
    return runtime.runtimeId === this.runtime.runtimeId &&
      equalSecret(runtime.ownershipCapability, this.runtime.ownershipCapability);
  }

  issue(runId: string, claimId: string): IssuedClaimCapability {
    const ownershipToken = randomBytes(32).toString('base64url');
    return Object.freeze({
      claimRef: Object.freeze({ runId, claimId, ownershipToken }),
      tokenHash: digest(ownershipToken),
    });
  }

  verifyClaim(claimRef: ClaimRef, stored: StoredClaimAuthority): boolean {
    return stored.ownerRuntimeId === this.runtime.runtimeId &&
      stored.runId === claimRef.runId && stored.claimId === claimRef.claimId &&
      equalSecret(digest(claimRef.ownershipToken), stored.tokenHash);
  }
}
