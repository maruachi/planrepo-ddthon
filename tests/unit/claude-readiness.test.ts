import { describe, expect, it } from 'vitest';
import { evaluateClaudeEvidence } from '@/src/runtime/claude-verification-status';
import { evidenceFixture } from '@/tests/helpers/claude-evidence';
import { isClaudeLiveCandidate } from '@/src/runtime/claude-live-candidate';

describe('Claude 지원 증거 판정', () => {
  it('does not activate real Claude from installation and mock evidence alone', () => {
    const report = evidenceFixture({
      cliProbe: 'Passed',
      optionProbe: 'Passed',
      fixtureContract: 'Passed',
      policyPreflight: 'Passed',
      actualGeneration: 'NotRun',
      actualIsolation: 'NotRun',
      sameBootRecovery: 'KnownUnsupported',
    });

    const status = evaluateClaudeEvidence(report);

    expect(status).toMatchObject({
      actualGenerationVerified: false,
      isolationVerified: false,
      eligibleForProduct: false,
    });
    expect(status.limitations).toContain('NQ21_SAME_BOOT_IDENTITY_UNAVAILABLE');
  });

  it('requires every real preflight and actual result while preserving the recovery limitation', () => {
    const status = evaluateClaudeEvidence(evidenceFixture({
      cliProbe: 'Passed', optionProbe: 'Passed', policyPreflight: 'Passed',
      fixtureContract: 'Passed', actualGeneration: 'Passed', actualIsolation: 'Passed',
      sameBootRecovery: 'KnownUnsupported',
    }));
    expect(status).toEqual({
      actualGenerationVerified: true,
      isolationVerified: true,
      eligibleForProduct: true,
      limitations: ['NQ21_SAME_BOOT_IDENTITY_UNAVAILABLE'],
    });
    expect(evaluateClaudeEvidence(evidenceFixture({
      cliProbe: 'Passed', optionProbe: 'Failed', policyPreflight: 'Passed',
      fixtureContract: 'Passed', actualGeneration: 'Passed', actualIsolation: 'Passed',
    }))).toMatchObject({ eligibleForProduct: false });
  });

  it('rejects passed evidence captured for a different profile', () => {
    const status = evaluateClaudeEvidence(evidenceFixture({
      profileVersion: 'claude-cli-other',
      cliProbe: 'Passed', optionProbe: 'Passed', policyPreflight: 'Passed',
      fixtureContract: 'Passed', actualGeneration: 'Passed', actualIsolation: 'Passed',
    }));

    expect(status).toMatchObject({ eligibleForProduct: false });
    expect(status.limitations).toContain('CLAUDE_PROFILE_MISMATCH');
  });

  it('does not accept an external passed-shaped object as a live candidate', () => {
    expect(isClaudeLiveCandidate({
      report: evidenceFixture({ cliProbe: 'Passed', optionProbe: 'Passed', policyPreflight: 'Passed' }),
      scopePolicyRef: `sha256:${'a'.repeat(64)}`,
      createProvider() { throw new Error('호출되면 안 됩니다.'); },
    } as never)).toBe(false);
  });
});
