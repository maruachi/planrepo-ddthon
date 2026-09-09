import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ControlledProcessRunner,
  type OwnedExecution,
  type ControlledProcessSpec,
} from '@/src/runtime/controlled-process-runner';
import type { ProcessObservationState, ProcessObserver } from '@/src/runtime/process-evidence';

const fixture = resolve(import.meta.dirname, '../fixtures/process-child.mjs');

function spec(
  mode: string,
  stdinBytes = Buffer.from('실제 한글 입력'),
  overrides: Partial<ControlledProcessSpec['limits']> = {},
): ControlledProcessSpec {
  return {
    executable: process.execPath,
    args: [fixture, mode],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    stdinBytes,
    launchRef: `os-${mode}`,
    limits: {
      stdinMaxBytes: 2_097_152,
      stdoutMaxBytes: 4_194_304,
      stderrMaxBytes: 262_144,
      timeoutMs: 300_000,
      terminationGraceMs: 2_000,
      ...overrides,
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('관찰 제한 시간을 넘었습니다.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

const ownedExecutions = new Set<OwnedExecution>();

function startOwned(specification: ControlledProcessSpec, observer?: ProcessObserver): OwnedExecution {
  const execution = new ControlledProcessRunner().start(specification, observer);
  ownedExecutions.add(execution);
  return execution;
}

afterEach(async () => {
  for (const execution of ownedExecutions) {
    execution.requestStop('OS fixture 테스트 정리');
    await waitFor(() => {
      const state = execution.getObservationState();
      return state.kind === 'Confirmed' || (state.kind === 'Unknown' &&
        state.directProcess?.stdoutClosed === true && state.directProcess.stderrClosed === true);
    }, 6_000);
  }
  ownedExecutions.clear();
});

describe('ControlledProcessRunner 실제 Node child', () => {
  it('큰 stdin과 한글 UTF-8 bytes를 pipe로 보내고 두 출력 close 뒤 완료합니다', async () => {
    const input = Buffer.from(`시작-${'가'.repeat(400_000)}-끝`);
    const execution = startOwned(spec('success', input));

    const result = await execution.result;
    expect(result.kind).toBe('Completed');
    if (result.kind !== 'Completed') return;
    expect(result.stdout.equals(input)).toBe(true);
    expect(result).toMatchObject({
      kind: 'Completed', stderrByteCount: 0, exitCode: 0,
      metrics: {
        stdoutBytes: input.byteLength,
        stderrBytes: 0,
        stdoutClosed: true,
        stderrClosed: true,
        exitCode: 0,
      },
    });
    expect(result.metrics.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(result.metrics.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(execution.getObservationState()).toMatchObject({
      kind: 'Unknown', reason: 'execution_scope_not_proven',
      directProcess: { stdoutClosed: true, stderrClosed: true, exitCode: 0 },
    });
  });

  it('stdout 종료 뒤 늦게 넘친 stderr를 부분 성공으로 처리하지 않습니다', async () => {
    const observations: ProcessObservationState[] = [];
    const execution = startOwned(
      spec('late-stderr-overflow'),
      (state) => observations.push(state),
    );

    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
    await waitFor(() => observations.some((state) => state.kind === 'Unknown' && state.reason === 'execution_scope_not_proven'));
  });

  it('stdout과 stderr 동시 flood를 각 raw-byte 상한까지 소비합니다', async () => {
    const execution = startOwned(spec('flood-both'));
    const result = await execution.result;

    expect(result).toMatchObject({ kind: 'Completed', stderrByteCount: 262_144 });
    expect(result.kind === 'Completed' && result.stdout.byteLength).toBe(4_194_304);
  });

  it('nonzero를 실패로 유지하고 invalid JSON 판정은 상위 provider에 남깁니다', async () => {
    const failed = startOwned(spec('nonzero'));
    await expect(failed.result).resolves.toMatchObject({ kind: 'Failure', code: 'PROCESS_FAILED', exitCode: 7 });

    const invalidJson = startOwned(spec('invalid-json'));
    await expect(invalidJson.result).resolves.toMatchObject({ kind: 'Completed', stdout: Buffer.from('not-json') });
  });

  it('SIGTERM에 반응한 child도 취소 결과와 늦은 종료 관찰을 분리합니다', async () => {
    const observations: ProcessObservationState[] = [];
    let running!: () => void;
    const started = new Promise<void>((resolveStarted) => { running = resolveStarted; });
    const execution = startOwned(spec('wait-for-term'), (state) => {
      observations.push(state);
      if (state.kind === 'Running') running();
    });
    await started;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    execution.requestStop('통합 테스트 취소');

    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'CANCELLED' });
    await waitFor(() => observations.some((state) => state.kind === 'Unknown' && state.reason === 'execution_scope_not_proven'));
  });

  it('SIGTERM을 무시한 자기 child만 grace 뒤 SIGKILL하고 관찰 범위는 Unknown입니다', async () => {
    const observations: ProcessObservationState[] = [];
    let running!: () => void;
    const started = new Promise<void>((resolveStarted) => { running = resolveStarted; });
    const execution = startOwned(spec('ignore-term'), (state) => {
      observations.push(state);
      if (state.kind === 'Running') running();
    });
    await started;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const stoppedAt = Date.now();
    execution.requestStop('강제 종료 경계 검증');

    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'CANCELLED' });
    await waitFor(
      () => observations.some((state) => state.kind === 'Unknown' && state.reason === 'execution_scope_not_proven'),
      5_000,
    );
    expect(Date.now() - stoppedAt).toBeGreaterThanOrEqual(1_900);
  }, 10_000);

  it('없는 실행 파일은 ENOENT no_process_created로 구분합니다', async () => {
    const execution = startOwned({
      ...spec('success'), executable: resolve(process.cwd(), 'definitely-missing-planrepo-executable'),
    });

    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'EXECUTABLE_NOT_FOUND' });
    expect(execution.getObservationState()).toMatchObject({
      kind: 'Confirmed', result: { kind: 'no_process_created' },
    });
  });
});
