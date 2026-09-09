import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { arch, release } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import {
  ControlledProcessRunner,
  type ControlledProcessSpec,
  type OwnedExecution,
} from '@/src/runtime/controlled-process-runner';
import type { ProcessObservationState, ProcessObserver } from '@/src/runtime/process-evidence';
import {
  APPROVED_CLAUDE_VERSION,
  CLAUDE_PROFILE_FINGERPRINT,
} from '@/src/providers/generation/claude-profile';

const CAPABILITY = Symbol('PlanRepoRestrictedProcessCapability');
const SANDBOX_EXECUTABLE = '/usr/bin/sandbox-exec';
const COMPILER_EXECUTABLE = '/usr/bin/xcrun';
const SW_VERS_EXECUTABLE = '/usr/bin/sw_vers';
const SANDBOX_PROFILE = '(version 1) (allow default) (deny process-fork)';
const APPROVED_PLATFORM_REF = 'darwin-25.6.0-macos-26.6.2-build-25G83-arm64';
const APPROVED_PROBE_SHA256 = 'a9460fa3f6441d03195697ddd4059df8c9876ec1d0c284804d64b7bc40be4020';

export interface RestrictedProcessCapability {
  readonly scopePolicyRef: string;
  readonly platformRef: string;
  readonly [CAPABILITY]: true;
}

export type RestrictedProcessVerification =
  | {
      readonly kind: 'Supported';
      readonly capability: RestrictedProcessCapability;
      readonly platformRef: string;
    }
  | {
      readonly kind: 'Unsupported';
      readonly reason:
        | 'UNSUPPORTED_PLATFORM'
        | 'PROFILE_MISMATCH'
        | 'PROBE_ASSET_MISMATCH'
        | 'COMPILER_UNAVAILABLE'
        | 'PROBE_EXECUTION_FAILED'
        | 'PROBE_RESULT_MISMATCH';
    };

interface BoundedResult {
  readonly pid?: number;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function boundedSpawn(
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly maxBytes: number },
): Promise<BoundedResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      cwd: options.cwd,
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let exceeded = false;
    const append = (current: Buffer, raw: Buffer | string): Buffer => {
      const next = Buffer.concat([current, Buffer.from(raw)]);
      if (next.byteLength > options.maxBytes) {
        exceeded = true;
        child.kill('SIGKILL');
        return next.subarray(0, options.maxBytes);
      }
      return next;
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', reject);
    const timer = setTimeout(() => {
      exceeded = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (exceeded) {
        reject(new Error('bounded process limit exceeded'));
        return;
      }
      resolvePromise({
        ...(pid === undefined ? {} : { pid }),
        code,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      });
    });
  });
}

async function platformRef(workRoot: string): Promise<string | undefined> {
  if (process.platform !== 'darwin' || arch() !== 'arm64' || release() !== '25.6.0') return undefined;
  const [product, build] = await Promise.all([
    boundedSpawn(SW_VERS_EXECUTABLE, ['-productVersion'], { cwd: workRoot, timeoutMs: 1_000, maxBytes: 128 }),
    boundedSpawn(SW_VERS_EXECUTABLE, ['-buildVersion'], { cwd: workRoot, timeoutMs: 1_000, maxBytes: 128 }),
  ]);
  if (product.code !== 0 || build.code !== 0 || product.stderr !== '' || build.stderr !== '') return undefined;
  return `darwin-${release()}-macos-${product.stdout.trim()}-build-${build.stdout.trim()}-${arch()}`;
}

function exactProbe(value: unknown, processPid: number, parentPid: number): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const probe = value as Record<string, unknown>;
  const keys = Object.keys(probe);
  return keys.length === 7 &&
    ['schemaVersion', 'pid', 'parentPid', 'forkErrno', 'vforkErrno',
      'posixSpawnResult', 'posixSpawnpResult'].every((key) => keys.includes(key)) &&
    probe.schemaVersion === 1 && probe.pid === processPid && probe.parentPid === parentPid &&
    probe.forkErrno === 1 && probe.vforkErrno === 1 &&
    probe.posixSpawnResult === 1 && probe.posixSpawnpResult === 1;
}

export function isRestrictedProcessCapability(value: RestrictedProcessCapability): boolean {
  return value[CAPABILITY] === true && value.platformRef === APPROVED_PLATFORM_REF &&
    /^sha256:[0-9a-f]{64}$/u.test(value.scopePolicyRef);
}

export async function verifyRestrictedProcessSupport(input: {
  readonly projectRoot: string;
  readonly workRoot: string;
  readonly claudeProfileFingerprint: string;
  readonly cliVersion: string;
}): Promise<RestrictedProcessVerification> {
  if (
    input.claudeProfileFingerprint !== CLAUDE_PROFILE_FINGERPRINT ||
    input.cliVersion !== APPROVED_CLAUDE_VERSION
  ) return { kind: 'Unsupported', reason: 'PROFILE_MISMATCH' };
  let sourcePath: string;
  let binaryPath: string;
  try {
    if (!isAbsolute(input.projectRoot) || !isAbsolute(input.workRoot)) throw new Error('relative path');
    const projectRoot = realpathSync(input.projectRoot);
    const workRoot = realpathSync(input.workRoot);
    const workStat = lstatSync(workRoot);
    if (!workStat.isDirectory() || workStat.isSymbolicLink()) throw new Error('work root');
    sourcePath = resolve(projectRoot, 'config/claude/no-fork-probe.c');
    const sourceStat = lstatSync(sourcePath);
    if (realpathSync(sourcePath) !== sourcePath || !sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error('probe asset');
    }
    const digest = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
    if (digest !== APPROVED_PROBE_SHA256) return { kind: 'Unsupported', reason: 'PROBE_ASSET_MISMATCH' };
    binaryPath = resolve(workRoot, 'planrepo-no-fork-probe');
    const observedPlatform = await platformRef(workRoot);
    if (observedPlatform !== APPROVED_PLATFORM_REF) return { kind: 'Unsupported', reason: 'UNSUPPORTED_PLATFORM' };
  } catch {
    return { kind: 'Unsupported', reason: 'PROBE_ASSET_MISMATCH' };
  }
  let compiled: BoundedResult;
  try {
    compiled = await boundedSpawn(COMPILER_EXECUTABLE, [
      'clang', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
      '-o', binaryPath, sourcePath,
    ], { cwd: input.workRoot, timeoutMs: 30_000, maxBytes: 4_096 });
  } catch {
    return { kind: 'Unsupported', reason: 'COMPILER_UNAVAILABLE' };
  }
  if (compiled.code !== 0 || compiled.signal !== null || compiled.stdout !== '' || compiled.stderr !== '') {
    return { kind: 'Unsupported', reason: 'COMPILER_UNAVAILABLE' };
  }
  let result: BoundedResult;
  try {
    result = await boundedSpawn(SANDBOX_EXECUTABLE, [
      '-p', SANDBOX_PROFILE, binaryPath,
    ], { cwd: input.workRoot, timeoutMs: 5_000, maxBytes: 4_096 });
  } catch {
    return { kind: 'Unsupported', reason: 'PROBE_EXECUTION_FAILED' };
  }
  if (result.code !== 0 || result.signal !== null || result.stderr !== '' || result.pid === undefined) {
    return { kind: 'Unsupported', reason: 'PROBE_EXECUTION_FAILED' };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout.trim()) as unknown; } catch {
    return { kind: 'Unsupported', reason: 'PROBE_RESULT_MISMATCH' };
  }
  if (!exactProbe(parsed, result.pid, process.pid)) {
    return { kind: 'Unsupported', reason: 'PROBE_RESULT_MISMATCH' };
  }
  const scopePolicyRef = `sha256:${createHash('sha256').update(JSON.stringify({
    platformRef: APPROVED_PLATFORM_REF,
    sandboxExecutable: SANDBOX_EXECUTABLE,
    sandboxProfile: SANDBOX_PROFILE,
    probeSha256: APPROVED_PROBE_SHA256,
    claudeProfileFingerprint: input.claudeProfileFingerprint,
    cliVersion: input.cliVersion,
  })).digest('hex')}`;
  const capability: RestrictedProcessCapability = Object.freeze({
    scopePolicyRef,
    platformRef: APPROVED_PLATFORM_REF,
    [CAPABILITY]: true as const,
  });
  return { kind: 'Supported', capability, platformRef: APPROVED_PLATFORM_REF };
}

export class RestrictedProcessRunner {
  private readonly runner = new ControlledProcessRunner();

  constructor(private readonly capability: RestrictedProcessCapability) {
    if (!isRestrictedProcessCapability(capability)) {
      throw new Error('restricted process capability가 올바르지 않습니다.');
    }
  }

  start(spec: ControlledProcessSpec, observer?: ProcessObserver): OwnedExecution {
    let runningPid: number | undefined;
    let current: ProcessObservationState = Object.freeze({
      kind: 'Pending', launchRef: spec.launchRef,
    });
    const publish = (state: ProcessObservationState) => {
      current = state;
      observer?.(state);
    };
    const owned = this.runner.start({
      ...spec,
      executable: SANDBOX_EXECUTABLE,
      args: Object.freeze(['-p', SANDBOX_PROFILE, spec.executable, ...spec.args]),
    }, (state) => {
      if (state.kind === 'Running') runningPid = state.pid;
      if (
        state.kind === 'Unknown' && state.reason === 'execution_scope_not_proven' &&
        state.directProcess !== undefined && state.directProcess.pid === runningPid &&
        state.directProcess.childClosed && state.directProcess.stdoutClosed &&
        state.directProcess.stderrClosed
      ) {
        publish(Object.freeze({
          kind: 'Confirmed',
          launchRef: state.launchRef,
          result: Object.freeze({
            kind: 'restricted_scope_exited',
            scopePolicyRef: this.capability.scopePolicyRef,
            exitCode: state.directProcess.exitCode,
            ...(state.directProcess.signal === null ? {} : { signal: state.directProcess.signal }),
          }),
        }));
        return;
      }
      publish(state);
    });
    return Object.freeze({
      result: owned.result,
      requestStop: (reason: string) => owned.requestStop(reason),
      getObservationState: () => current,
    });
  }
}
