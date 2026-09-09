import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import {
  noProcessCreated,
  unknownProcess,
  type ProcessObservationState,
  type ProcessObserver,
} from './process-evidence';

export interface ProcessLimits {
  readonly stdinMaxBytes: number;
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
  readonly timeoutMs: number;
  readonly terminationGraceMs: number;
}

export interface ControlledProcessSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly stdinBytes: Buffer;
  readonly launchRef: string;
  readonly limits: ProcessLimits;
}

export type ProcessFailureCode =
  | 'EXECUTABLE_NOT_FOUND'
  | 'SPAWN_ERROR'
  | 'POLICY_CONFLICT'
  | 'INPUT_LIMIT'
  | 'INPUT_ERROR'
  | 'OUTPUT_LIMIT'
  | 'PROCESS_FAILED'
  | 'IO_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED';

export interface ProcessResultMetrics {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutClosed: boolean;
  readonly stderrClosed: boolean;
  readonly exitCode?: number;
  readonly terminationSignal?: NodeJS.Signals;
}

type ProcessResultCore =
  | {
      readonly kind: 'Completed';
      readonly stdout: Buffer;
      readonly stderrByteCount: number;
      readonly exitCode: 0;
      readonly closedAtMono: number;
      readonly deadlineMono: number;
    }
  | {
      readonly kind: 'Failure';
      readonly code: ProcessFailureCode;
      readonly exitCode?: number | null;
    };

export type ProcessResult = ProcessResultCore & {
  readonly metrics: ProcessResultMetrics;
};

export interface OwnedExecution {
  readonly result: Promise<ProcessResult>;
  requestStop(reason: string): void;
  getObservationState(): ProcessObservationState;
}

export interface ProcessReadable {
  on(event: 'data', listener: (chunk: Buffer | Uint8Array | string) => void): this;
  on(event: 'end' | 'close', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  removeAllListeners(): this;
}

export interface ProcessWritable {
  on(event: 'drain', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  write(chunk: Buffer): boolean;
  end(): void;
  removeAllListeners(): this;
}

export interface SpawnedProcess {
  readonly pid: number | undefined;
  readonly stdin: ProcessWritable;
  readonly stdout: ProcessReadable;
  readonly stderr: ProcessReadable;
  on(event: 'spawn', listener: () => void): this;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
  on(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  isSameOwnedLiveScope(): boolean;
  removeAllListeners(): this;
}

export type SignalResult = 'sent' | 'not_found' | 'denied' | 'unknown';

export interface SpawnPort {
  spawn(
    executable: string,
    args: readonly string[],
    options: {
      readonly shell: false;
      readonly detached: true;
      readonly cwd: string;
      readonly env: Readonly<NodeJS.ProcessEnv>;
      readonly stdio: readonly ['pipe', 'pipe', 'pipe'];
    },
  ): SpawnedProcess;
  signal(process: SpawnedProcess, signal: 'SIGTERM' | 'SIGKILL'): SignalResult;
}

export interface MonotonicClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface WallClock {
  now(): Date;
}

const systemClock: MonotonicClock = {
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

const systemWallClock: WallClock = { now: () => new Date() };

class NodeSpawnedProcess implements SpawnedProcess {
  private spawned = false;
  private exited = false;
  private closed = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.once('spawn', () => { this.spawned = true; });
    child.once('exit', () => { this.exited = true; });
    child.once('close', () => { this.closed = true; });
  }

  get pid(): number | undefined { return this.child.pid; }
  get stdin(): ProcessWritable { return this.child.stdin; }
  get stdout(): ProcessReadable { return this.child.stdout; }
  get stderr(): ProcessReadable { return this.child.stderr; }

  on(event: 'spawn', listener: () => void): this;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
  on(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    this.child.on(event, listener);
    return this;
  }

  isSameOwnedLiveScope(): boolean {
    return this.spawned && !this.exited && !this.closed && this.child.pid !== undefined && this.child.pid > 1;
  }

  removeAllListeners(): this {
    this.child.removeAllListeners();
    return this;
  }
}

const nodeSpawnPort: SpawnPort = {
  spawn(executable, args, options) {
    return new NodeSpawnedProcess(nodeSpawn(executable, [...args], {
      shell: options.shell,
      detached: options.detached,
      cwd: options.cwd,
      env: { ...options.env },
      stdio: [...options.stdio],
    }));
  },
  signal(processHandle, signal) {
    if (!processHandle.isSameOwnedLiveScope() || processHandle.pid === undefined) return 'unknown';
    try {
      process.kill(-processHandle.pid, signal);
      return 'sent';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return 'not_found';
      if (code === 'EPERM') return 'denied';
      return 'unknown';
    }
  },
};

const MAXIMUM_LIMITS: ProcessLimits = Object.freeze({
  stdinMaxBytes: 2_097_152,
  stdoutMaxBytes: 4_194_304,
  stderrMaxBytes: 262_144,
  timeoutMs: 300_000,
  terminationGraceMs: 2_000,
});

function supportedLimits(limits: ProcessLimits): boolean {
  return (Object.keys(MAXIMUM_LIMITS) as Array<keyof ProcessLimits>).every((key) =>
    Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= MAXIMUM_LIMITS[key]);
}

function snapshotSpec(spec: ControlledProcessSpec): ControlledProcessSpec {
  return Object.freeze({
    executable: spec.executable,
    args: Object.freeze([...spec.args]),
    cwd: spec.cwd,
    env: Object.freeze({ ...spec.env }),
    stdinBytes: Buffer.from(spec.stdinBytes),
    launchRef: spec.launchRef,
    limits: Object.freeze({ ...spec.limits }),
  });
}

export class ControlledProcessRunner {
  constructor(
    private readonly spawnPort: SpawnPort = nodeSpawnPort,
    private readonly clock: MonotonicClock = systemClock,
    private readonly wallClock: WallClock = systemWallClock,
  ) {}

  start(spec: ControlledProcessSpec, observer: ProcessObserver = () => undefined): OwnedExecution {
    const executionSpec = snapshotSpec(spec);
    const spawnAttemptMono = this.clock.now();
    const startedAt = this.wallClock.now().toISOString();
    const deadlineMono = spawnAttemptMono + executionSpec.limits.timeoutMs;
    let observation: ProcessObservationState = Object.freeze({
      kind: 'Pending', launchRef: executionSpec.launchRef,
    });
    let resolveResult!: (result: ProcessResult) => void;
    let settled = false;
    const result = new Promise<ProcessResult>((resolve) => { resolveResult = resolve; });
    let processHandle: SpawnedProcess | undefined;
    let deadlineTimer: unknown;
    let killTimer: unknown;
    let spawned = false;
    let spawnFailedBeforeStart = false;
    let childClosed = false;
    let exitSeen = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let stdoutClosed = false;
    let stderrClosed = false;
    let ioError = false;
    let stdoutByteCount = 0;
    let stderrByteCount = 0;
    let terminationRequested = false;
    let terminationStarted = false;
    const stdoutChunks: Buffer[] = [];

    const publish = (next: ProcessObservationState) => {
      observation = next;
      observer(next);
    };
    const settle = (next: ProcessResultCore) => {
      if (settled) return;
      settled = true;
      const metrics: ProcessResultMetrics = Object.freeze({
        startedAt,
        finishedAt: this.wallClock.now().toISOString(),
        stdoutBytes: stdoutByteCount,
        stderrBytes: stderrByteCount,
        stdoutClosed,
        stderrClosed,
        ...(exitCode === null ? {} : { exitCode }),
        ...(exitSignal === null ? {} : { terminationSignal: exitSignal }),
      });
      resolveResult(Object.freeze({ ...next, metrics }) as ProcessResult);
    };
    const clearTimersAfterClose = () => {
      if (deadlineTimer !== undefined) this.clock.clearTimer(deadlineTimer);
      if (killTimer !== undefined) this.clock.clearTimer(killTimer);
    };
    const cleanupListeners = () => {
      processHandle?.stdin.removeAllListeners();
      processHandle?.stdout.removeAllListeners();
      processHandle?.stderr.removeAllListeners();
      processHandle?.removeAllListeners();
    };
    const publishClosedScope = () => {
      const pid = processHandle?.pid;
      publish(unknownProcess(executionSpec.launchRef, 'execution_scope_not_proven', pid === undefined ? undefined : {
        pid, exitCode, signal: exitSignal, stdoutClosed, stderrClosed, childClosed,
      }));
    };
    const maybeComplete = () => {
      if (!exitSeen || !childClosed || !stdoutClosed || !stderrClosed) return;
      clearTimersAfterClose();
      publishClosedScope();
      if (!settled) {
        if (ioError) {
          settle({ kind: 'Failure', code: 'IO_ERROR', exitCode });
        } else if (exitCode !== 0) {
          settle({ kind: 'Failure', code: 'PROCESS_FAILED', exitCode });
        } else {
          const closedAtMono = this.clock.now();
          if (closedAtMono > deadlineMono) {
            settle({ kind: 'Failure', code: 'TIMEOUT' });
          } else {
            settle({
              kind: 'Completed',
              stdout: Buffer.concat(stdoutChunks, stdoutByteCount),
              stderrByteCount,
              exitCode: 0,
              closedAtMono,
              deadlineMono,
            });
          }
        }
      }
      cleanupListeners();
    };
    const recordSignalUncertainty = (signalResult: SignalResult) => {
      if (signalResult === 'denied') publish(unknownProcess(executionSpec.launchRef, 'signal_denied'));
      if (signalResult === 'not_found' || signalResult === 'unknown') {
        publish(unknownProcess(executionSpec.launchRef, 'signal_result_unknown'));
      }
    };
    const beginTermination = () => {
      terminationRequested = true;
      if (processHandle === undefined || exitSeen || childClosed || !processHandle.isSameOwnedLiveScope()) return;
      if (terminationStarted) return;
      terminationStarted = true;
      const termResult = this.spawnPort.signal(processHandle, 'SIGTERM');
      if (termResult !== 'sent') recordSignalUncertainty(termResult);
      killTimer ??= this.clock.setTimer(() => {
        if (processHandle === undefined || exitSeen || childClosed || !processHandle.isSameOwnedLiveScope()) return;
        const killResult = this.spawnPort.signal(processHandle, 'SIGKILL');
        if (killResult !== 'sent') recordSignalUncertainty(killResult);
      }, executionSpec.limits.terminationGraceMs);
    };
    const failAndTerminate = (code: ProcessFailureCode) => {
      settle({ kind: 'Failure', code });
      beginTermination();
    };
    const onPipeError = () => {
      ioError = true;
      failAndTerminate('IO_ERROR');
    };
    const requestStop = (_reason: string) => {
      if (childClosed) return;
      settle({ kind: 'Failure', code: 'CANCELLED' });
      beginTermination();
    };

    const owned: OwnedExecution = Object.freeze({
      result,
      requestStop,
      getObservationState: () => observation,
    });

    if (!supportedLimits(executionSpec.limits)) {
      publish(noProcessCreated(executionSpec.launchRef, 'execution_policy_rejected_before_spawn'));
      settle({ kind: 'Failure', code: 'POLICY_CONFLICT' });
      return owned;
    }

    if (executionSpec.stdinBytes.byteLength > executionSpec.limits.stdinMaxBytes) {
      publish(noProcessCreated(executionSpec.launchRef, 'stdin_byte_limit_rejected_before_spawn'));
      settle({ kind: 'Failure', code: 'INPUT_LIMIT' });
      return owned;
    }

    try {
      processHandle = this.spawnPort.spawn(executionSpec.executable, executionSpec.args, {
        shell: false,
        detached: true,
        cwd: executionSpec.cwd,
        env: executionSpec.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      publish(unknownProcess(executionSpec.launchRef, 'spawn_crash_gap'));
      settle({ kind: 'Failure', code: 'SPAWN_ERROR' });
      return owned;
    }

    processHandle.stdin.on('error', () => failAndTerminate('INPUT_ERROR'));
    processHandle.stdout.on('error', onPipeError);
    processHandle.stderr.on('error', onPipeError);
    processHandle.stdout.on('data', (raw) => {
      const chunk = Buffer.from(raw);
      stdoutByteCount += chunk.byteLength;
      if (stdoutByteCount > executionSpec.limits.stdoutMaxBytes) {
        failAndTerminate('OUTPUT_LIMIT');
        return;
      }
      stdoutChunks.push(chunk);
    });
    processHandle.stderr.on('data', (raw) => {
      const chunk = Buffer.from(raw);
      stderrByteCount += chunk.byteLength;
      if (stderrByteCount > executionSpec.limits.stderrMaxBytes) failAndTerminate('OUTPUT_LIMIT');
    });
    processHandle.stdout.on('close', () => { stdoutClosed = true; maybeComplete(); });
    processHandle.stderr.on('close', () => { stderrClosed = true; maybeComplete(); });
    processHandle.on('spawn', () => {
      spawned = true;
      const pid = processHandle?.pid;
      if (pid !== undefined) publish(Object.freeze({ kind: 'Running', launchRef: executionSpec.launchRef, pid }));
      if (terminationRequested) {
        beginTermination();
        return;
      }
      const writable = processHandle?.stdin;
      if (writable === undefined) return;
      if (executionSpec.stdinBytes.byteLength === 0) {
        writable.end();
      } else if (!writable.write(executionSpec.stdinBytes)) {
        writable.on('drain', () => writable.end());
      } else {
        writable.end();
      }
    });
    processHandle.on('error', (error) => {
      if (!spawned && error.code === 'ENOENT') {
        spawnFailedBeforeStart = true;
        publish(noProcessCreated(executionSpec.launchRef, 'spawn_error_ENOENT'));
        settle({ kind: 'Failure', code: 'EXECUTABLE_NOT_FOUND' });
        clearTimersAfterClose();
        return;
      }
      if (!spawned) {
        spawnFailedBeforeStart = true;
        publish(unknownProcess(executionSpec.launchRef, 'spawn_error_not_proven'));
        clearTimersAfterClose();
      }
      failAndTerminate('SPAWN_ERROR');
    });
    processHandle.on('exit', (code, signal) => {
      exitSeen = true;
      exitCode = code;
      exitSignal = signal;
      if (killTimer !== undefined) this.clock.clearTimer(killTimer);
      publishClosedScope();
      if (code !== 0 && code !== null) settle({ kind: 'Failure', code: 'PROCESS_FAILED', exitCode: code });
      maybeComplete();
    });
    processHandle.on('close', (code, signal) => {
      childClosed = true;
      exitCode ??= code;
      exitSignal ??= signal;
      if (spawnFailedBeforeStart) {
        clearTimersAfterClose();
        cleanupListeners();
        return;
      }
      maybeComplete();
    });

    deadlineTimer = this.clock.setTimer(() => {
      if (childClosed) return;
      if (this.clock.now() <= deadlineMono) return;
      failAndTerminate('TIMEOUT');
    }, executionSpec.limits.timeoutMs + 1);

    return owned;
  }
}
