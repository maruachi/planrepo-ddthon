export type ClaudeEvidenceState = 'Passed' | 'Failed' | 'NotRun' | 'KnownUnsupported';

export interface ClaudeVerificationReport {
  readonly schemaVersion: 1;
  readonly profileVersion: string;
  readonly profileFingerprint: string;
  readonly approvedCliVersion: string;
  readonly cliProbe: ClaudeEvidenceState;
  readonly optionProbe: ClaudeEvidenceState;
  readonly policyPreflight: ClaudeEvidenceState;
  readonly fixtureContract: ClaudeEvidenceState;
  readonly actualGeneration: ClaudeEvidenceState;
  readonly actualIsolation: ClaudeEvidenceState;
  readonly sameBootRecovery: ClaudeEvidenceState;
}

export interface StoredClaudeVerification extends ClaudeVerificationReport {
  readonly scopePolicyRef: string;
}

export interface ClaudeVerificationStatus {
  readonly actualGenerationVerified: boolean;
  readonly isolationVerified: boolean;
  readonly eligibleForProduct: boolean;
  readonly limitations: readonly string[];
}

const REQUIRED_PREFLIGHT = [
  'cliProbe', 'optionProbe', 'policyPreflight', 'fixtureContract',
] as const satisfies readonly (keyof ClaudeVerificationReport)[];

const EVIDENCE_STATES = new Set<ClaudeEvidenceState>([
  'Passed', 'Failed', 'NotRun', 'KnownUnsupported',
]);

const STORED_KEYS = new Set([
  'schemaVersion', 'profileVersion', 'profileFingerprint', 'approvedCliVersion',
  'scopePolicyRef', 'cliProbe', 'optionProbe', 'policyPreflight', 'fixtureContract',
  'actualGeneration', 'actualIsolation', 'sameBootRecovery',
]);

export function parseStoredClaudeVerification(value: unknown): StoredClaudeVerification | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  if (keys.length !== STORED_KEYS.size || keys.some((key) => !STORED_KEYS.has(key)) ||
    item.schemaVersion !== 1 || typeof item.profileVersion !== 'string' ||
    typeof item.profileFingerprint !== 'string' || typeof item.approvedCliVersion !== 'string' ||
    typeof item.scopePolicyRef !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(item.scopePolicyRef) ||
    !EVIDENCE_STATES.has(item.cliProbe as ClaudeEvidenceState) ||
    !EVIDENCE_STATES.has(item.optionProbe as ClaudeEvidenceState) ||
    !EVIDENCE_STATES.has(item.policyPreflight as ClaudeEvidenceState) ||
    !EVIDENCE_STATES.has(item.fixtureContract as ClaudeEvidenceState) ||
    !EVIDENCE_STATES.has(item.actualGeneration as ClaudeEvidenceState) ||
    !EVIDENCE_STATES.has(item.actualIsolation as ClaudeEvidenceState) ||
    !EVIDENCE_STATES.has(item.sameBootRecovery as ClaudeEvidenceState)) return undefined;
  return Object.freeze(item as unknown as StoredClaudeVerification);
}

export function evaluateClaudeEvidence(report: ClaudeVerificationReport): ClaudeVerificationStatus {
  const profileMatches = report.schemaVersion === 1 &&
    report.profileVersion === CLAUDE_PROFILE_VERSION &&
    report.profileFingerprint === CLAUDE_PROFILE_FINGERPRINT &&
    report.approvedCliVersion === APPROVED_CLAUDE_VERSION;
  const actualGenerationVerified = report.actualGeneration === 'Passed';
  const isolationVerified = report.actualIsolation === 'Passed';
  const preflightVerified = REQUIRED_PREFLIGHT.every((key) => report[key] === 'Passed');
  const limitations: string[] = [];
  if (!actualGenerationVerified) limitations.push('ACTUAL_GENERATION_NOT_VERIFIED');
  if (!isolationVerified) limitations.push('ACTUAL_ISOLATION_NOT_VERIFIED');
  if (!preflightVerified) limitations.push('CLAUDE_PREFLIGHT_NOT_VERIFIED');
  if (!profileMatches) limitations.push('CLAUDE_PROFILE_MISMATCH');
  if (report.sameBootRecovery !== 'Passed') {
    limitations.push('NQ21_SAME_BOOT_IDENTITY_UNAVAILABLE');
  }
  return {
    actualGenerationVerified,
    isolationVerified,
    eligibleForProduct: actualGenerationVerified && isolationVerified && preflightVerified && profileMatches,
    limitations: Object.freeze(limitations),
  };
}
import {
  APPROVED_CLAUDE_VERSION,
  CLAUDE_PROFILE_FINGERPRINT,
} from '@/src/providers/generation/claude-profile';
import { CLAUDE_PROFILE_VERSION } from '@/src/providers/generation/claude-result';
