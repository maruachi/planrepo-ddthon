import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { watch } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import type { FingerprintGuard, SrScope } from '@/src/contracts/context';
import type { GenerationInput } from '@/src/contracts/views';
import type { TestApp } from '@/tests/helpers/test-app';
import type { RuntimeRecoveryObservation } from '@/src/generation-runtime/recovery';

export type RuntimeWorkerOperation =
  | {
      readonly kind: 'claim';
      readonly closeDelayMs?: number;
      readonly terminalBeforeObservation?: 'succeeded';
      readonly spawnChildBeforePidPersistence?: true;
    }
  | {
      readonly kind: 'request';
      readonly scope: SrScope;
      readonly actorId: string;
      readonly idempotencyKey: string;
      readonly guard: FingerprintGuard;
      readonly input: GenerationInput;
    };

export type RuntimeWorkerResult =
  | {
      readonly kind: 'claim';
      readonly runId?: string;
      readonly claimId?: string;
      readonly terminalStatus?: 'succeeded';
      readonly errorCode?: string;
    }
  | {
      readonly kind: 'request';
      readonly disposition: 'Committed' | 'Replayed' | 'Rejected';
      readonly runId?: string;
      readonly errorCode?: string;
    };

interface WorkerControlInput {
  readonly databasePath: string;
  readonly runtimeId: string;
  readonly barrier: string;
  readonly operation: RuntimeWorkerOperation;
}

interface WorkerOwnerIdentity {
  readonly runtimeId: string;
  readonly ownerPid: number;
  readonly managerPid: number;
  readonly executionMode: 'direct-owned-node';
}

export interface RuntimeWorkerChildIdentity {
  readonly childPid: number;
  readonly parentPid: number;
  readonly phase: 'spawned_before_pid_persistence';
}

interface ChildControl {
  readonly ready: Promise<RuntimeWorkerChildIdentity>;
  stop(): Promise<void>;
  closeUnused(): Promise<void>;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  if (await exists(path)) return;
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      watcher.close();
      resolvePromise();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      watcher.close();
      reject(new Error(`runtime worker control timeout: ${path}`));
    }, timeoutMs);
    const check = async () => { if (await exists(path)) finish(); };
    const watcher = watch(dirname(path), () => { void check(); });
    const poller = setInterval(() => { void check(); }, 25);
  });
}

function parseOwnerIdentity(value: string, runtimeId: string, childPid: number): WorkerOwnerIdentity {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch {
    throw new Error('runtime worker owner identity JSON이 올바르지 않습니다.');
  }
  if (
    typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    !('runtimeId' in parsed) || parsed.runtimeId !== runtimeId ||
    !('ownerPid' in parsed) || parsed.ownerPid !== childPid ||
    !('managerPid' in parsed) || parsed.managerPid !== childPid ||
    !('executionMode' in parsed) || parsed.executionMode !== 'direct-owned-node'
  ) throw new Error('runtime worker가 부모 소유 child handle과 일치하지 않습니다.');
  return {
    runtimeId,
    ownerPid: childPid,
    managerPid: childPid,
    executionMode: 'direct-owned-node',
  };
}

function ownerTermination(child: ChildProcess): Promise<void> {
  let exitObserved = child.exitCode !== null || child.signalCode !== null;
  let closeObserved = false;
  return new Promise<void>((resolvePromise) => {
    const finish = () => {
      if (exitObserved && closeObserved) resolvePromise();
    };
    child.once('exit', () => { exitObserved = true; finish(); });
    child.once('close', () => { closeObserved = true; finish(); });
  });
}

async function waitForOwnerTermination(termination: Promise<void>, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('실제 DB owner process 종료를 확인하지 못했습니다.'));
    }, timeoutMs);
    void termination.then(() => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolvePromise, reject) => {
    server.close((error) => error === undefined ? resolvePromise() : reject(error));
  });
}

async function createChildControl(controlDir: string): Promise<ChildControl> {
  const socketPath = join(controlDir, 'child-control.sock');
  let childSocket: Socket | undefined;
  let received = '';
  let resolveReady!: (identity: RuntimeWorkerChildIdentity) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<RuntimeWorkerChildIdentity>((resolvePromise, reject) => {
    resolveReady = resolvePromise;
    rejectReady = reject;
  });
  const server = createServer((socket) => {
    if (childSocket !== undefined) {
      socket.destroy(new Error('둘 이상의 제한 child 연결을 허용하지 않습니다.'));
      return;
    }
    childSocket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
      const newline = received.indexOf('\n');
      if (newline < 0) return;
      let parsed: unknown;
      try { parsed = JSON.parse(received.slice(0, newline)) as unknown; } catch {
        rejectReady(new Error('제한 child identity JSON이 올바르지 않습니다.'));
        return;
      }
      if (
        typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
        !('childPid' in parsed) || !Number.isInteger(parsed.childPid) || Number(parsed.childPid) <= 1 ||
        !('parentPid' in parsed) || !Number.isInteger(parsed.parentPid) || Number(parsed.parentPid) <= 1 ||
        !('phase' in parsed) || parsed.phase !== 'spawned_before_pid_persistence'
      ) {
        rejectReady(new Error('제한 child identity가 올바르지 않습니다.'));
        return;
      }
      resolveReady({
        childPid: Number(parsed.childPid),
        parentPid: Number(parsed.parentPid),
        phase: 'spawned_before_pid_persistence',
      });
    });
    socket.once('error', (error) => rejectReady(error));
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolvePromise);
  });
  const waitForChildClose = async (socket: Socket): Promise<void> => {
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('제한 child control 종료를 확인하지 못했습니다.')), 15_000);
      socket.once('close', () => { clearTimeout(timer); resolvePromise(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
  };
  return {
    ready,
    async stop() {
      await ready;
      const socket = childSocket;
      if (socket === undefined || socket.destroyed) {
        throw new Error('제한 child의 live control channel이 없습니다.');
      }
      const closed = waitForChildClose(socket);
      socket.end('STOP\n');
      await closed;
      await closeServer(server);
      const exit = JSON.parse(await readFile(join(controlDir, 'CHILD_EXIT.json'), 'utf8')) as unknown;
      if (
        typeof exit !== 'object' || exit === null || Array.isArray(exit) ||
        !('reason' in exit) || exit.reason !== 'control-stop'
      ) throw new Error('제한 child가 control channel로 종료되지 않았습니다.');
    },
    async closeUnused() {
      childSocket?.destroy();
      await closeServer(server);
    },
  };
}

export async function startRuntimeWorker(input: {
  readonly app: TestApp;
  readonly testWorkerId: string;
  readonly barrier: string;
  readonly closeConfirmationTimeoutMs?: number;
  readonly operation: RuntimeWorkerOperation;
}): Promise<{
  readonly ready: Promise<void>;
  readonly release: () => Promise<void>;
  readonly result: Promise<RuntimeWorkerResult>;
  readonly crashOwnedWorker: () => Promise<void>;
  readonly confirmedRecoveryObservation: () => RuntimeRecoveryObservation;
  readonly childSpawnedBeforePidPersistence: () => Promise<RuntimeWorkerChildIdentity>;
  readonly stopSpawnedChild: () => Promise<void>;
  readonly close: () => Promise<void>;
}> {
  if (!/^[a-z0-9-]+$/u.test(input.testWorkerId)) throw new Error('testWorkerId가 올바르지 않습니다.');
  if (!/^[a-z0-9-]+$/u.test(input.barrier)) throw new Error('barrier가 올바르지 않습니다.');
  if (
    input.closeConfirmationTimeoutMs !== undefined &&
    (!Number.isInteger(input.closeConfirmationTimeoutMs) || input.closeConfirmationTimeoutMs <= 0)
  ) throw new Error('close 확인 제한시간이 올바르지 않습니다.');
  const databasePath = realpathSync(input.app.db.name);
  const testRoot = dirname(dirname(databasePath));
  const controlRoot = resolve(testRoot, 'control');
  const controlDir = resolve(controlRoot, input.testWorkerId);
  if (dirname(controlDir) !== controlRoot) throw new Error('runtime worker control scope가 올바르지 않습니다.');
  await mkdir(controlDir, { recursive: true });
  const childControl = input.operation.kind === 'claim' &&
    input.operation.spawnChildBeforePidPersistence === true
    ? await createChildControl(controlDir)
    : undefined;
  const runtimeId = `test-runtime-${input.testWorkerId}`;
  const controlInput: WorkerControlInput = {
    databasePath,
    runtimeId,
    barrier: input.barrier,
    operation: input.operation,
  };
  await writeFile(join(controlDir, 'INPUT.json'), JSON.stringify(controlInput), { flag: 'wx' });
  const projectRoot = process.cwd();
  const child = spawn(process.execPath, [
    '--import', 'tsx', 'tests/fixtures/runtime-worker.ts',
  ], {
    cwd: projectRoot,
    env: { ...process.env, PLANREPO_RUNTIME_WORKER_CONTROL: controlDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const terminated = ownerTermination(child);
  let diagnostics = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-4000);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-4000);
  });
  const readyPath = join(controlDir, 'READY.json');
  const resultPath = join(controlDir, 'RESULT.json');
  const ready = Promise.race([
    waitForFile(readyPath),
    terminated.then(() => { throw new Error(`runtime worker가 READY 전에 종료됐습니다.\n${diagnostics}`); }),
  ]);
  const ownerIdentity = async (): Promise<WorkerOwnerIdentity> => {
    await ready;
    if (child.pid === undefined) throw new Error('직접 소유한 DB owner child PID를 확인하지 못했습니다.');
    const owner = parseOwnerIdentity(await readFile(readyPath, 'utf8'), runtimeId, child.pid);
    const stored = input.app.db.prepare(
      'SELECT parent_pid,parent_started_at FROM runtime_identities WHERE runtime_id=?',
    ).get(runtimeId) as { readonly parent_pid: number; readonly parent_started_at: string } | undefined;
    if (stored?.parent_pid !== owner.ownerPid || stored.parent_started_at !== 'direct-owned-node') {
      throw new Error('runtime worker owner handle이 DB 등록과 일치하지 않습니다.');
    }
    return owner;
  };
  const result = (async () => {
    await Promise.race([
      waitForFile(resultPath),
      terminated.then(() => { throw new Error('runtime worker가 RESULT 전에 종료됐습니다.'); }),
    ]);
    return JSON.parse(await readFile(resultPath, 'utf8')) as RuntimeWorkerResult;
  })().catch((error) => {
    throw new Error(`runtime worker 결과를 읽지 못했습니다: ${String(error)}\n${diagnostics}`);
  });
  void result.catch(() => undefined);
  let requestedControl: 'CRASH' | 'CLOSE' | undefined;
  let proofWritten = false;
  const confirmTermination = async (control: 'CRASH' | 'CLOSE'): Promise<void> => {
    const owner = await ownerIdentity();
    if (requestedControl === undefined) {
      requestedControl = control;
      await writeFile(join(controlDir, `${control}.json`), JSON.stringify({ control: control.toLowerCase() }), {
        flag: 'wx',
      });
    } else if (requestedControl !== control) {
      throw new Error('runtime worker에 서로 다른 종료 요청을 보낼 수 없습니다.');
    }
    await waitForOwnerTermination(
      terminated,
      control === 'CLOSE' ? (input.closeConfirmationTimeoutMs ?? 15_000) : 15_000,
    );
    if (!proofWritten) {
      await writeFile(join(controlDir, 'OWNER_EXIT.json'), JSON.stringify({
        ...owner, termination: 'confirmed-owner-exit',
      }), { flag: 'wx' });
      proofWritten = true;
    }
  };
  return {
    ready,
    async release() {
      await ready;
      await writeFile(join(controlDir, 'RELEASE.json'), '{"release":true}', { flag: 'wx' });
    },
    result,
    async crashOwnedWorker() {
      await confirmTermination('CRASH');
    },
    confirmedRecoveryObservation() {
      if (!proofWritten || requestedControl !== 'CRASH') {
        throw new Error('실제 DB owner process 종료를 먼저 확인해야 합니다.');
      }
      return {
        source: 'Test',
        hostRelation: 'same',
        bootRelation: 'same',
        hostRebootEvidence: 'unavailable',
        startIdentity: 'confirmed_owner_exit',
        ownerPidCheck: 'ESRCH',
        executionTermination: 'unknown',
      };
    },
    async childSpawnedBeforePidPersistence() {
      if (childControl === undefined) throw new Error('제한 child fixture가 활성화되지 않았습니다.');
      const [identity, barrierText] = await Promise.all([
        childControl.ready,
        waitForFile(join(controlDir, 'CHILD_BEFORE_PID_PERSISTENCE.json')).then(() =>
          readFile(join(controlDir, 'CHILD_BEFORE_PID_PERSISTENCE.json'), 'utf8')),
      ]);
      const barrier = JSON.parse(barrierText) as RuntimeWorkerChildIdentity;
      if (
        barrier.childPid !== identity.childPid || barrier.parentPid !== identity.parentPid ||
        barrier.phase !== identity.phase
      ) throw new Error('worker의 child spawn barrier와 control identity가 다릅니다.');
      return identity;
    },
    async stopSpawnedChild() {
      if (childControl === undefined) throw new Error('제한 child fixture가 활성화되지 않았습니다.');
      await childControl.stop();
    },
    async close() {
      if (childControl !== undefined) {
        try { await childControl.stop(); } catch (error) {
          await childControl.closeUnused().catch(() => undefined);
          throw error;
        }
      }
      if (requestedControl === 'CRASH') {
        await waitForOwnerTermination(terminated, 15_000);
        return;
      }
      await confirmTermination('CLOSE');
    },
  };
}
