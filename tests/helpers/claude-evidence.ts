import type {
  ClaudeVerificationReport,
} from '@/src/runtime/claude-verification-status';
import {
  APPROVED_CLAUDE_VERSION,
  CLAUDE_PROFILE_FINGERPRINT,
} from '@/src/providers/generation/claude-profile';
import { CLAUDE_PROFILE_VERSION } from '@/src/providers/generation/claude-result';

const defaultReport: ClaudeVerificationReport = Object.freeze({
  schemaVersion: 1,
  profileVersion: CLAUDE_PROFILE_VERSION,
  profileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
  approvedCliVersion: APPROVED_CLAUDE_VERSION,
  cliProbe: 'NotRun',
  optionProbe: 'NotRun',
  policyPreflight: 'NotRun',
  fixtureContract: 'NotRun',
  actualGeneration: 'NotRun',
  actualIsolation: 'NotRun',
  sameBootRecovery: 'KnownUnsupported',
});

export function evidenceFixture(
  overrides: Partial<ClaudeVerificationReport> = {},
): ClaudeVerificationReport {
  return Object.freeze({ ...defaultReport, ...overrides });
}
