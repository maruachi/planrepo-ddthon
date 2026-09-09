import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { createGenerationInternalService } from '@/src/application/generation-internal';
import { createGenerationService } from '@/src/application/generation-service';
import { createCurrentInputFingerprintPort } from '@/src/application/generation-preparation';
import { ClaimContextAuthority } from '@/src/generation-runtime/claim-context';
import { openPlanRepoDatabase } from '@/src/persistence/database';
import { registerRuntime, unregisterRuntime } from '@/src/persistence/maintenance';
import { createPersistence } from '@/src/persistence/transaction';
import { CLAUDE_PROFILE_VERSION } from '@/src/providers/generation/claude-result';
import { loadRuntimeConfig } from '@/src/runtime/config';
import { loadProjectRuleSource } from '@/src/runtime/project-rule-source';
import type { RuntimeWorkerOperation, RuntimeWorkerResult } from '@/tests/helpers/runtime-workers';
import type { ProviderCompletion } from '@/src/contracts/views';

interface ControlInput {
  readonly databasePath: string;
  readonly runtimeId: string;
  readonly barrier: string;
  readonly operation: RuntimeWorkerOperation;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function waitForEither(paths: readonly string[], timeoutMs = 15_000): Promise<string> {
  const existing = await Promise.all(paths.map(exists));
  const index = existing.findIndex(Boolean);
  if (index >= 0) return paths[index] ?? '';
  return new Promise<string>((resolvePromise, reject) => {
    let settled = false;
    const finish = (path: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      watcher.close();
      resolvePromise(path);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      watcher.close();
      reject(new Error('runtime worker barrier timeout'));
    }, timeoutMs);
    const check = async () => {
      for (const path of paths) {
        if (!await exists(path)) continue;
        finish(path);
        return;
      }
    };
    const watcher = watch(dirname(paths[0] ?? ''), () => { void check(); });
    const poller = setInterval(() => { void check(); }, 25);
  });
}

function validControl(value: unknown): value is ControlInput {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'databasePath' in value && typeof value.databasePath === 'string' &&
    'runtimeId' in value && typeof value.runtimeId === 'string' &&
    'barrier' in value && typeof value.barrier === 'string' &&
    'operation' in value && typeof value.operation === 'object' && value.operation !== null;
}

async function spawnLimitedChildBeforePidPersistence(controlDir: string): Promise<{
  readonly childPid: number;
  readonly parentPid: number;
  readonly phase: 'spawned_before_pid_persistence';
}> {
  const childProgram = String.raw`
    const { writeFileSync } = require('node:fs');
    const { join } = require('node:path');
    const { createConnection } = require('node:net');
    const controlDir = process.argv[1];
    const socket = createConnection(join(controlDir, 'child-control.sock'));
    let finished = false;
    const finish = (reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(lifetime);
      writeFileSync(join(controlDir, 'CHILD_EXIT.json'), JSON.stringify({
        childPid: process.pid, reason,
      }), { flag: 'wx' });
      socket.end(() => process.exit(0));
    };
    const lifetime = setTimeout(() => finish('finite-timeout'), 15000);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      const identity = {
        childPid: process.pid,
        parentPid: process.ppid,
        phase: 'spawned_before_pid_persistence',
      };
      writeFileSync(join(controlDir, 'CHILD_READY.json'), JSON.stringify(identity), { flag: 'wx' });
      socket.write(JSON.stringify(identity) + '\n');
    });
    socket.on('data', (value) => {
      if (value.includes('STOP\n')) finish('control-stop');
    });
    socket.on('error', () => finish('control-error'));
  `;
  const child = spawn(process.execPath, ['-e', childProgram, controlDir], {
    cwd: controlDir,
    env: {},
    shell: false,
    detached: false,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await new Promise<void>((resolvePromise, reject) => {
    child.once('spawn', resolvePromise);
    child.once('error', reject);
  });
  await waitForEither([join(controlDir, 'CHILD_READY.json')]);
  const parsed = JSON.parse(await readFile(join(controlDir, 'CHILD_READY.json'), 'utf8')) as unknown;
  assert(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed));
  assert('childPid' in parsed && parsed.childPid === child.pid);
  assert('parentPid' in parsed && parsed.parentPid === process.pid);
  assert('phase' in parsed && parsed.phase === 'spawned_before_pid_persistence');
  return {
    childPid: Number(parsed.childPid),
    parentPid: Number(parsed.parentPid),
    phase: 'spawned_before_pid_persistence',
  };
}

async function main(): Promise<void> {
  const controlDir = process.env.PLANREPO_RUNTIME_WORKER_CONTROL;
  assert(controlDir !== undefined, 'runtime worker control이 없습니다.');
  const parsed = JSON.parse(await readFile(join(controlDir, 'INPUT.json'), 'utf8')) as unknown;
  assert(validControl(parsed), 'runtime worker 입력이 올바르지 않습니다.');
  assert.match(parsed.barrier, /^[a-z0-9-]+$/u);
  const databasePath = realpathSync(parsed.databasePath);
  assert.equal(databasePath, realpathSync(resolve(controlDir, '../..', 'data/planrepo.sqlite')));
  const db = openPlanRepoDatabase(databasePath);
  let ownsClaim = false;
  let crashRequested = false;
  try {
    registerRuntime(db, {
      runtimeId: parsed.runtimeId,
      hostId: `test-host-${parsed.runtimeId}`,
      bootId: `test-boot-${parsed.runtimeId}`,
      parentPid: process.pid,
      parentStartedAt: 'direct-owned-node',
      registeredAt: '2026-09-09T04:00:00.000Z',
    });
    await writeFile(join(controlDir, 'READY.json'), JSON.stringify({
      ready: true,
      runtimeId: parsed.runtimeId,
      ownerPid: process.pid,
      managerPid: process.pid,
      executionMode: 'direct-owned-node',
    }), { flag: 'wx' });
    const startControl = await waitForEither([
      join(controlDir, 'RELEASE.json'), join(controlDir, 'CRASH.json'), join(controlDir, 'CLOSE.json'),
    ]);
    if (startControl.endsWith('CRASH.json')) {
      crashRequested = true;
      process.kill(process.pid, 'SIGKILL');
      await new Promise<void>(() => undefined);
    }
    if (startControl.endsWith('CLOSE.json')) {
      const result: RuntimeWorkerResult = parsed.operation.kind === 'request'
        ? { kind: 'request', disposition: 'Rejected', errorCode: 'WORKER_CLOSED' }
        : { kind: 'claim', errorCode: 'WORKER_CLOSED' };
      await writeFile(join(controlDir, 'RESULT.json'), JSON.stringify(result), { flag: 'wx' });
      unregisterRuntime(db, parsed.runtimeId);
      return;
    }

    let result: RuntimeWorkerResult;
    try {
      if (parsed.operation.kind === 'claim') {
        const claims = new ClaimContextAuthority(parsed.runtimeId);
        const completionEvidence = new WeakMap<ProviderCompletion, {
          readonly completedAtMono: number;
          readonly deadlineMono: number;
        }>();
        const config = loadRuntimeConfig(process.cwd(), {
          PLANREPO_MODE: 'test', PLANREPO_TEST_RUN_ID: 'runtime-worker',
        });
        const service = createGenerationInternalService({
          persistence: createPersistence(db),
          claims,
          evidence: {
            completion: (input) => completionEvidence.get(input),
            failure: () => false,
            termination: () => false,
          },
          executionPolicy: {
            profileVersion: CLAUDE_PROFILE_VERSION,
            timeoutMs: 300_000,
            stdoutMaxBytes: 4_194_304,
            stderrMaxBytes: 262_144,
            normalizedResultMaxBytes: 2_097_152,
          },
          draftMaxBytes: config.limits.draftBytes,
          monotonicClock: { now: () => 0 },
          now: () => '2026-09-09T04:00:00.000Z',
        });
        const claimed = service.claimRun(claims.runtime);
        ownsClaim = claimed !== null;
        if (claimed === null) {
          result = { kind: 'claim' };
        } else if (parsed.operation.spawnChildBeforePidPersistence === true) {
          const identity = await spawnLimitedChildBeforePidPersistence(controlDir);
          await writeFile(
            join(controlDir, 'CHILD_BEFORE_PID_PERSISTENCE.json'),
            JSON.stringify(identity),
            { flag: 'wx' },
          );
          const childGapControl = await waitForEither([
            join(controlDir, 'CRASH.json'), join(controlDir, 'CLOSE.json'),
          ]);
          if (childGapControl.endsWith('CRASH.json')) {
            crashRequested = true;
            process.kill(process.pid, 'SIGKILL');
            await new Promise<void>(() => undefined);
          }
          result = {
            kind: 'claim', runId: claimed.claimRef.runId, claimId: claimed.claimRef.claimId,
          };
        } else if (parsed.operation.terminalBeforeObservation === 'succeeded') {
          const completion: ProviderCompletion = {
            claimRef: claimed.claimRef,
            result: {
              schemaVersion: 1,
              kind: 'question_proposals',
              proposals: [{
                temporaryId: 'runtime-worker-proposal',
                text: '실제 worker terminal gap을 확인할 질문은 무엇인가요?',
                reason: 'M-050 전 성공 commit 보존을 확인합니다.',
                suggestedAssigneeId: 'persona-p01-owner',
                requiredGate: 'G1',
                sourceRefs: [],
                candidateAnswers: [],
              }],
            },
            execution: {
              providerId: claimed.selection.providerId,
              actualModelId: 'self-owned-node-fixture',
              cliVersion: 'test-only',
              profileVersion: claimed.executionPolicy.profileVersion,
              startedAt: '2026-09-09T04:00:00.000Z',
              finishedAt: '2026-09-09T04:00:01.000Z',
              exitCode: 0,
              stdoutBytes: 128,
              stderrBytes: 0,
              stdoutClosed: true,
              stderrClosed: true,
            },
          };
          completionEvidence.set(completion, { completedAtMono: 50, deadlineMono: 100 });
          const terminal = service.completeRun(completion);
          assert.equal(terminal.kind, 'Recorded');
          result = {
            kind: 'claim', runId: claimed.claimRef.runId,
            claimId: claimed.claimRef.claimId, terminalStatus: 'succeeded',
          };
        } else {
          result = { kind: 'claim', runId: claimed.claimRef.runId, claimId: claimed.claimRef.claimId };
        }
      } else {
        const config = loadRuntimeConfig(process.cwd(), {
          PLANREPO_MODE: 'test', PLANREPO_TEST_RUN_ID: 'runtime-worker',
        });
        const rules = loadProjectRuleSource(process.cwd()).rules;
        const service = createGenerationService({
          persistence: createPersistence(db),
          projectRules: rules,
          selection: {
            providerId: config.generation.providerId,
            modelChoice: config.generation.modelChoice,
          },
          maxNonterminal: config.generation.maxNonterminal,
          providerInputBytes: config.limits.providerInputBytes,
          currentInputFingerprints: createCurrentInputFingerprintPort(rules),
          now: () => '2026-09-09T04:00:00.000Z',
        });
        const command = service.requestGeneration({
          actor: {
            actorId: parsed.operation.actorId,
            projectId: parsed.operation.scope.projectId,
            roles: [], srAssignments: [], demo: true,
          },
          scope: parsed.operation.scope,
          requestId: `request-${parsed.runtimeId}`,
          idempotencyKey: parsed.operation.idempotencyKey,
          guard: parsed.operation.guard,
        }, parsed.operation.input);
        result = command.kind === 'Rejected'
          ? { kind: 'request', disposition: 'Rejected', errorCode: command.error.code }
          : { kind: 'request', disposition: command.kind, runId: command.value.runId };
      }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : error instanceof Error ? error.name : 'UNKNOWN';
      result = parsed.operation.kind === 'request'
        ? { kind: 'request', disposition: 'Rejected', errorCode: code }
        : { kind: 'claim', errorCode: code };
    }
    await writeFile(join(controlDir, 'RESULT.json'), JSON.stringify(result), { flag: 'wx' });
    const ending = await waitForEither([
      join(controlDir, 'CRASH.json'), join(controlDir, 'CLOSE.json'),
    ]);
    if (ending.endsWith('CRASH.json')) {
      crashRequested = true;
      process.kill(process.pid, 'SIGKILL');
    }
    const closeDelayMs = parsed.operation.kind === 'claim'
      ? parsed.operation.closeDelayMs
      : undefined;
    if (closeDelayMs !== undefined) {
      assert(Number.isInteger(closeDelayMs) && closeDelayMs >= 0);
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, closeDelayMs));
    }
    if (!ownsClaim) unregisterRuntime(db, parsed.runtimeId);
  } finally {
    if (db.open) db.close();
    if (crashRequested) await new Promise<void>(() => undefined);
  }
}

void main().catch(() => {
  process.stderr.write('runtime worker 실행에 실패했습니다.\n');
  process.exitCode = 1;
});
