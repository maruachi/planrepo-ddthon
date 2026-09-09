import type { ExecutionReport, ProviderFailureCore } from '../../contracts/views';
import type {
  ControlledProcessRunner,
  ControlledProcessSpec,
  OwnedExecution,
  ProcessResult,
  ProcessResultMetrics,
} from '../../runtime/controlled-process-runner';
import type { ProcessObserver } from '../../runtime/process-evidence';
import { noProcessCreated, unknownProcess } from '../../runtime/process-evidence';
import type { ProviderOutcomeEvidenceSink } from '../../generation-runtime/execution-evidence-registry';
import {
  APPROVED_CLAUDE_VERSION,
  buildClaudeLaunchProfile,
  materializeClaudeEmptyMcpConfig,
  snapshotClaudeEmptyMcpConfig,
  snapshotClaudeInheritedEnvironment,
} from './claude-profile';
import { decodeClaudeResult } from './claude-result';
import type { ExecutionControl, GenerationProvider, ProviderOutcome, ProviderRequest } from './provider-contract';

type ProcessRunnerPort = Pick<ControlledProcessRunner, 'start'>;

export interface ClaudeCliProviderOptions {
  readonly runner: ProcessRunnerPort;
  readonly projectRoot: string;
  readonly mcpConfigPath: string;
  readonly sourceEnvironment: Readonly<NodeJS.ProcessEnv>;
  readonly cliVersion: string;
  readonly observer?: ProcessObserver;
  readonly evidenceSink?: ProviderOutcomeEvidenceSink;
  readonly now?: () => Date;
}

function frozenRequest(request: ProviderRequest): ProviderRequest {
  return JSON.parse(JSON.stringify(request)) as ProviderRequest;
}

function policyMatches(control: ExecutionControl): boolean {
  const policy = control.policy;
  return policy.profileVersion === 'claude-cli-2.1.265-planrepo-v2' &&
    policy.timeoutMs === 300_000 && policy.stdoutMaxBytes === 4_194_304 &&
    policy.stderrMaxBytes === 262_144 && policy.normalizedResultMaxBytes === 2_097_152;
}

function report(
  request: ProviderRequest,
  profileVersion: string,
  cliVersion: string,
  metrics: ProcessResultMetrics,
): ExecutionReport {
  return {
    providerId: request.selection.providerId,
    cliVersion,
    profileVersion,
    startedAt: metrics.startedAt,
    finishedAt: metrics.finishedAt,
    ...(metrics.exitCode === undefined ? {} : { exitCode: metrics.exitCode }),
    ...(metrics.terminationSignal === undefined ? {} : { terminationSignal: metrics.terminationSignal }),
    stdoutBytes: metrics.stdoutBytes,
    stderrBytes: metrics.stderrBytes,
    stdoutClosed: metrics.stdoutClosed,
    stderrClosed: metrics.stderrClosed,
  };
}

function failureCode(result: Extract<ProcessResult, { kind: 'Failure' }>): ProviderFailureCore['code'] {
  if (result.code === 'EXECUTABLE_NOT_FOUND') return 'EXECUTABLE_NOT_FOUND';
  if (result.code === 'OUTPUT_LIMIT') return 'OUTPUT_LIMIT';
  if (result.code === 'TIMEOUT') return 'TIMEOUT';
  if (result.code === 'CANCELLED') return 'CANCELLED';
  if (result.code === 'POLICY_CONFLICT' || result.code === 'INPUT_LIMIT') return 'POLICY_CONFLICT';
  return 'PROCESS_FAILED';
}

function processFailure(
  request: ProviderRequest,
  result: Extract<ProcessResult, { kind: 'Failure' }>,
  profileVersion: string,
  cliVersion: string,
): ProviderOutcome {
  return {
    kind: 'failed',
    failure: { code: failureCode(result), diagnostic: 'Claude 제한 실행이 완료되지 않았습니다.' },
    execution: report(request, profileVersion, cliVersion, result.metrics),
  };
}

function immediateFailure(
  request: ProviderRequest,
  code: ProviderFailureCore['code'],
  diagnostic: string,
  profileVersion: string,
  cliVersion: string,
  now: () => Date,
): ProviderOutcome {
  const at = now().toISOString();
  return {
    kind: 'failed',
    failure: { code, diagnostic },
    execution: {
      providerId: request.selection.providerId,
      cliVersion,
      profileVersion,
      startedAt: at,
      finishedAt: at,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutClosed: false,
      stderrClosed: false,
    },
  };
}

export function createClaudeCliProvider(options: ClaudeCliProviderOptions): GenerationProvider {
  const runner = options.runner;
  const emptyMcpSnapshot = snapshotClaudeEmptyMcpConfig(options.projectRoot, options.mcpConfigPath);
  const cliVersion = options.cliVersion;
  const observer = options.observer;
  const evidenceSink = options.evidenceSink;
  const inheritedEnvironment = snapshotClaudeInheritedEnvironment(options.sourceEnvironment);
  const now = options.now ?? (() => new Date());
  const publish = (state: Parameters<ProcessObserver>[0]) => {
    try { observer?.(state); } catch { /* C-05 owns durable observer error handling. */ }
  };
  return Object.freeze({
    async generate(request: ProviderRequest, control: ExecutionControl): Promise<ProviderOutcome> {
      const ownedRequest = frozenRequest(request);
      const execution = Object.freeze({ ...control.execution });
      const policy = Object.freeze({ ...control.policy });
      if (control.signal.aborted) {
        publish(noProcessCreated(execution.launchRef, 'cancelled_before_provider_spawn'));
        const outcome = immediateFailure(
          ownedRequest, 'CANCELLED', 'Claude 실행이 시작 전에 취소됐습니다.',
          policy.profileVersion, cliVersion, now,
        );
        evidenceSink?.record(outcome, { kind: 'failure' });
        return outcome;
      }
      if (!policyMatches({ ...control, policy })) {
        publish(noProcessCreated(execution.launchRef, 'execution_policy_rejected_before_spawn'));
        const outcome = immediateFailure(
          ownedRequest, 'POLICY_CONFLICT', 'Claude 실행 정책이 승인된 profile과 다릅니다.',
          policy.profileVersion, cliVersion, now,
        );
        evidenceSink?.record(outcome, { kind: 'failure' });
        return outcome;
      }
      if (cliVersion !== APPROVED_CLAUDE_VERSION) {
        publish(noProcessCreated(execution.launchRef, 'cli_version_rejected_before_spawn'));
        const outcome = immediateFailure(
          ownedRequest, 'UNAVAILABLE', 'Claude CLI version이 승인된 후보와 다릅니다.',
          policy.profileVersion, cliVersion, now,
        );
        evidenceSink?.record(outcome, { kind: 'failure' });
        return outcome;
      }
      let profile;
      try {
        const mcpConfig = materializeClaudeEmptyMcpConfig(emptyMcpSnapshot, execution.cwd);
        profile = buildClaudeLaunchProfile({
          selection: ownedRequest.selection,
          mcpConfig,
          tmpDir: execution.cwd,
          sourceEnvironment: inheritedEnvironment,
        });
      } catch {
        publish(noProcessCreated(execution.launchRef, 'profile_rejected_before_spawn'));
        const outcome = immediateFailure(
          ownedRequest, 'POLICY_CONFLICT', 'Claude 실행 profile 입력이 승인된 경계와 다릅니다.',
          policy.profileVersion, cliVersion, now,
        );
        evidenceSink?.record(outcome, { kind: 'failure' });
        return outcome;
      }
      const stdinBytes = Buffer.from(JSON.stringify(ownedRequest), 'utf8');
      const spec: ControlledProcessSpec = Object.freeze({
        executable: profile.executable,
        args: profile.args,
        cwd: execution.cwd,
        env: profile.env,
        stdinBytes,
        launchRef: execution.launchRef,
        limits: Object.freeze({
          stdinMaxBytes: 2_097_152,
          stdoutMaxBytes: policy.stdoutMaxBytes,
          stderrMaxBytes: policy.stderrMaxBytes,
          timeoutMs: policy.timeoutMs,
          terminationGraceMs: 2_000,
        }),
      });
      const safeObserver: ProcessObserver = (state) => {
        publish(state);
      };
      let owned: OwnedExecution;
      try {
        owned = runner.start(spec, safeObserver);
      } catch {
        publish(unknownProcess(execution.launchRef, 'spawn_crash_gap'));
        const outcome = immediateFailure(
          ownedRequest, 'PROCESS_FAILED', 'Claude 실행 시작 경계에서 오류가 발생했습니다.',
          profile.profileVersion, cliVersion, now,
        );
        evidenceSink?.record(outcome, { kind: 'failure' });
        return outcome;
      }
      const onAbort = () => owned.requestStop('provider request aborted');
      control.signal.addEventListener('abort', onAbort, { once: true });
      if (control.signal.aborted) onAbort();
      try {
        const result = await owned.result;
        if (result.kind === 'Failure') {
          const outcome = processFailure(ownedRequest, result, profile.profileVersion, cliVersion);
          evidenceSink?.record(outcome, { kind: 'failure' });
          return outcome;
        }
        const outcome = decodeClaudeResult({
          request: ownedRequest,
          process: result,
          stdout: result.stdout,
          providerId: ownedRequest.selection.providerId,
          profileVersion: profile.profileVersion,
          cliVersion,
          normalizedResultMaxBytes: policy.normalizedResultMaxBytes,
        });
        evidenceSink?.record(
          outcome,
          outcome.kind === 'completed'
            ? {
                kind: 'completion',
                completedAtMono: result.closedAtMono,
                deadlineMono: result.deadlineMono,
              }
            : { kind: 'failure' },
        );
        return outcome;
      } finally {
        control.signal.removeEventListener('abort', onAbort);
      }
    },
  });
}
