import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ProviderOutcomeEvidenceSink } from '@/src/generation-runtime/execution-evidence-registry';
import { createClaudeCliProvider } from '@/src/providers/generation/claude-cli';
import {
  APPROVED_CLAUDE_VERSION,
  CLAUDE_PROFILE_FINGERPRINT,
} from '@/src/providers/generation/claude-profile';
import { CLAUDE_PROFILE_VERSION } from '@/src/providers/generation/claude-result';
import type { GenerationProvider } from '@/src/providers/generation/provider-contract';
import type { ProcessObserver } from '@/src/runtime/process-evidence';
import {
  RestrictedProcessRunner,
  verifyRestrictedProcessSupport,
} from '@/src/runtime/restricted-process-runner';
import type { ClaudeVerificationReport } from '@/src/runtime/claude-verification-status';

const LIVE_CANDIDATE = Symbol('PlanRepoClaudeLiveCandidate');
const REQUIRED_OPTIONS = Object.freeze([
  '--print', '--input-format', '--output-format', '--model', '--tools', '--disallowedTools',
  '--strict-mcp-config', '--mcp-config', '--no-session-persistence', '--disable-slash-commands',
  '--no-chrome', '--permission-mode', '--permission-prompts', '--settings', '--system-prompt',
]);

interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function boundedCommand(
  executable: string,
  args: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  maxBytes: number,
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      env: { ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let invalid = false;
    const append = (current: Buffer, raw: Buffer | string) => {
      const next = Buffer.concat([current, Buffer.from(raw)]);
      if (next.byteLength > maxBytes) {
        invalid = true;
        child.kill('SIGKILL');
      }
      return next.subarray(0, maxBytes);
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', reject);
    const timer = setTimeout(() => {
      invalid = true;
      child.kill('SIGKILL');
    }, 5_000);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (invalid) {
        reject(new Error('Claude preflight command limit exceeded'));
        return;
      }
      resolvePromise({
        code, signal,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      });
    });
  });
}

export interface ClaudeLiveCandidate {
  readonly report: ClaudeVerificationReport;
  readonly scopePolicyRef: string;
  createProvider(input: {
    readonly observer: ProcessObserver;
    readonly evidenceSink: ProviderOutcomeEvidenceSink;
  }): GenerationProvider;
  readonly [LIVE_CANDIDATE]: true;
}

export type ClaudeLiveCandidateResult =
  | { readonly kind: 'Eligible'; readonly candidate: ClaudeLiveCandidate }
  | {
      readonly kind: 'Unavailable';
      readonly report: ClaudeVerificationReport;
      readonly reason: string;
    };

export function isClaudeLiveCandidate(value: ClaudeLiveCandidate): boolean {
  return value[LIVE_CANDIDATE] === true;
}

function report(overrides: Partial<ClaudeVerificationReport>): ClaudeVerificationReport {
  return Object.freeze({
    schemaVersion: 1,
    profileVersion: CLAUDE_PROFILE_VERSION,
    profileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
    approvedCliVersion: APPROVED_CLAUDE_VERSION,
    cliProbe: 'NotRun', optionProbe: 'NotRun', policyPreflight: 'NotRun',
    fixtureContract: 'NotRun', actualGeneration: 'NotRun', actualIsolation: 'NotRun',
    sameBootRecovery: 'KnownUnsupported',
    ...overrides,
  });
}

export async function verifyClaudeLiveCandidate(input: {
  readonly projectRoot: string;
  readonly workRoot: string;
  readonly sourceEnvironment: Readonly<NodeJS.ProcessEnv>;
}): Promise<ClaudeLiveCandidateResult> {
  let version: CommandResult;
  let help: CommandResult;
  try {
    [version, help] = await Promise.all([
      boundedCommand('claude', ['--version'], input.sourceEnvironment, 1_024),
      boundedCommand('claude', ['--help'], input.sourceEnvironment, 32_768),
    ]);
  } catch {
    return { kind: 'Unavailable', report: report({ cliProbe: 'Failed' }), reason: 'CLI_PROBE_FAILED' };
  }
  const cliPassed = version.code === 0 && version.signal === null && version.stderr === '' &&
    version.stdout.trim() === `${APPROVED_CLAUDE_VERSION} (Claude Code)`;
  const optionPassed = help.code === 0 && help.signal === null && help.stderr === '' &&
    REQUIRED_OPTIONS.every((option) => new RegExp(`(^|\\s)${option}(?=\\s|,|$)`, 'mu').test(help.stdout));
  const preflightReport = report({
    cliProbe: cliPassed ? 'Passed' : 'Failed',
    optionProbe: optionPassed ? 'Passed' : 'Failed',
    policyPreflight: cliPassed && optionPassed ? 'Passed' : 'Failed',
  });
  if (!cliPassed || !optionPassed) {
    return { kind: 'Unavailable', report: preflightReport, reason: 'CLI_PROFILE_MISMATCH' };
  }
  const restricted = await verifyRestrictedProcessSupport({
    projectRoot: input.projectRoot,
    workRoot: input.workRoot,
    claudeProfileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
    cliVersion: APPROVED_CLAUDE_VERSION,
  });
  if (restricted.kind !== 'Supported') {
    return {
      kind: 'Unavailable',
      report: preflightReport,
      reason: `RESTRICTED_SCOPE_${restricted.reason}`,
    };
  }
  const candidateReport = report({
    cliProbe: 'Passed', optionProbe: 'Passed', policyPreflight: 'Passed',
  });
  const runner = new RestrictedProcessRunner(restricted.capability);
  const inheritedEnvironment = Object.freeze({ ...input.sourceEnvironment });
  const candidate: ClaudeLiveCandidate = Object.freeze({
    report: candidateReport,
    scopePolicyRef: restricted.capability.scopePolicyRef,
    createProvider({ observer, evidenceSink }: {
      readonly observer: ProcessObserver;
      readonly evidenceSink: ProviderOutcomeEvidenceSink;
    }) {
      return createClaudeCliProvider({
        runner,
        projectRoot: input.projectRoot,
        mcpConfigPath: resolve(input.projectRoot, 'config/claude/mcp-empty.json'),
        sourceEnvironment: inheritedEnvironment,
        cliVersion: APPROVED_CLAUDE_VERSION,
        observer,
        evidenceSink,
      });
    },
    [LIVE_CANDIDATE]: true as const,
  });
  return { kind: 'Eligible', candidate };
}
