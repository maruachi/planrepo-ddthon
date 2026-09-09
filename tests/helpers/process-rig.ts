import { EventEmitter } from 'node:events';
import {
  ControlledProcessRunner,
  type ControlledProcessSpec,
  type MonotonicClock,
  type OwnedExecution,
  type ProcessReadable,
  type ProcessResult,
  type ProcessWritable,
  type SignalResult,
  type SpawnedProcess,
  type SpawnPort,
  type WallClock,
} from '@/src/runtime/controlled-process-runner';
import type { ProcessObservationState } from '@/src/runtime/process-evidence';

interface RigOptions {
  readonly stdinBackpressure?: boolean;
  readonly spawnError?: NodeJS.ErrnoException;
  readonly spawnThrows?: Error;
  readonly signalResults?: readonly SignalResult[];
}

class FakeReadable extends EventEmitter implements ProcessReadable {
}

class FakeWritable extends EventEmitter implements ProcessWritable {
  ended = false;
  readonly chunks: Buffer[] = [];

  constructor(private readonly backpressure: boolean) { super(); }

  write(chunk: Buffer): boolean {
    this.chunks.push(Buffer.from(chunk));
    return !this.backpressure;
  }

  end(): void { this.ended = true; }

}

class FakeProcess extends EventEmitter implements SpawnedProcess {
  readonly pid = 4242;
  readonly stdin: FakeWritable;
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  spawned = false;
  closed = false;

  constructor(backpressure: boolean) {
    super();
    this.stdin = new FakeWritable(backpressure);
  }

  isSameOwnedLiveScope(): boolean { return this.spawned && !this.closed; }
}

interface FakeTimer {
  readonly at: number;
  readonly callback: () => void;
  cancelled: boolean;
}

class FakeClock implements MonotonicClock {
  current = 0;
  private readonly timers: FakeTimer[] = [];

  now(): number { return this.current; }

  setTimer(callback: () => void, delayMs: number): FakeTimer {
    const timer = { at: this.current + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return timer;
  }

  clearTimer(timer: unknown): void {
    (timer as FakeTimer).cancelled = true;
  }

  advance(ms: number): void {
    const target = this.current + ms;
    while (true) {
      const next = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((left, right) => left.at - right.at)[0];
      if (next === undefined) break;
      this.current = next.at;
      next.cancelled = true;
      next.callback();
    }
    this.current = target;
  }

  pendingTimers(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }
}

class FakeWallClock implements WallClock {
  constructor(private readonly monotonic: FakeClock) {}

  now(): Date {
    return new Date(Date.parse('2026-09-09T00:00:00.000Z') + this.monotonic.now());
  }
}

const defaultSpec = (): ControlledProcessSpec => ({
  executable: '/fake/node',
  args: ['fixture.mjs', 'success'],
  cwd: '/fake/run',
  env: Object.freeze({ PATH: '/fake' }),
  stdinBytes: Buffer.from('입력'),
  launchRef: 'launch-test-1',
  limits: {
    stdinMaxBytes: 2_097_152,
    stdoutMaxBytes: 4_194_304,
    stderrMaxBytes: 262_144,
    timeoutMs: 300_000,
    terminationGraceMs: 2_000,
  },
});

export function createProcessRig(options: RigOptions = {}) {
  const clock = new FakeClock();
  const processHandle = new FakeProcess(options.stdinBackpressure ?? false);
  const sentSignals: Array<'SIGTERM' | 'SIGKILL'> = [];
  const observed: ProcessObservationState[] = [];
  let signalIndex = 0;
  let settled = false;
  let execution: OwnedExecution | undefined;
  let receivedArgs: readonly string[] = [];
  let receivedEnv: Readonly<NodeJS.ProcessEnv> = {};

  const spawnPort: SpawnPort = {
    spawn(_executable, args, spawnOptions) {
      if (options.spawnThrows !== undefined) throw options.spawnThrows;
      receivedArgs = args;
      receivedEnv = spawnOptions.env;
      if (spawnOptions.shell !== false || spawnOptions.detached !== true ||
        JSON.stringify(spawnOptions.stdio) !== JSON.stringify(['pipe', 'pipe', 'pipe'])) {
        throw new Error('runner가 제한된 spawn option을 사용하지 않았습니다.');
      }
      queueMicrotask(() => {
        if (options.spawnError !== undefined) {
          processHandle.emit('error', options.spawnError);
          return;
        }
        processHandle.spawned = true;
        processHandle.emit('spawn');
      });
      return processHandle;
    },
    signal(handle, signal) {
      if (handle !== processHandle) return 'unknown';
      sentSignals.push(signal);
      const configured = options.signalResults?.[signalIndex];
      signalIndex += 1;
      return configured ?? 'sent';
    },
  };
  const runner = new ControlledProcessRunner(spawnPort, clock, new FakeWallClock(clock));

  return {
    start(overrides: Partial<ControlledProcessSpec> = {}): OwnedExecution {
      if (execution !== undefined) throw new Error('rig는 실행 하나만 지원합니다.');
      execution = runner.start({ ...defaultSpec(), ...overrides }, (state) => observed.push(state));
      void execution.result.then(() => { settled = true; });
      return execution;
    },
    stdout(chunk: Buffer): void { processHandle.stdout.emit('data', chunk); },
    stdoutEnd(): void {
      processHandle.stdout.emit('end');
      processHandle.stdout.emit('close');
    },
    stderr(chunk: Buffer): void { processHandle.stderr.emit('data', chunk); },
    stderrEnd(): void {
      processHandle.stderr.emit('end');
      processHandle.stderr.emit('close');
    },
    exit(code: number | null, signal: NodeJS.Signals | null = null): void {
      processHandle.emit('exit', code, signal);
    },
    close(code: number | null, signal: NodeJS.Signals | null = null): void {
      processHandle.closed = true;
      processHandle.emit('close', code, signal);
    },
    advance(ms: number): void { clock.advance(ms); },
    async flush(): Promise<void> {
      await Promise.resolve();
      await Promise.resolve();
    },
    resultSettled(): boolean { return settled; },
    signals(): readonly string[] { return [...sentSignals]; },
    stdinDrain(): void { processHandle.stdin.emit('drain'); },
    stdinEnded(): boolean { return processHandle.stdin.ended; },
    stdinBytes(): Buffer { return Buffer.concat(processHandle.stdin.chunks); },
    spawnArgs(): readonly string[] { return [...receivedArgs]; },
    spawnEnv(): Readonly<NodeJS.ProcessEnv> { return { ...receivedEnv }; },
    stdinError(error: Error): void { processHandle.stdin.emit('error', error); },
    pipeError(pipe: 'stdout' | 'stderr', error: Error): void { processHandle[pipe].emit('error', error); },
    observations(): readonly ProcessObservationState[] { return [...observed]; },
    result(): Promise<ProcessResult> | undefined { return execution?.result; },
    pendingTimers(): number { return clock.pendingTimers(); },
    listenerCount(): number {
      return processHandle.eventNames().reduce((count, event) => count + processHandle.listenerCount(event), 0)
        + processHandle.stdin.eventNames().reduce((count, event) => count + processHandle.stdin.listenerCount(event), 0)
        + processHandle.stdout.eventNames().reduce((count, event) => count + processHandle.stdout.listenerCount(event), 0)
        + processHandle.stderr.eventNames().reduce((count, event) => count + processHandle.stderr.listenerCount(event), 0);
    },
  };
}
