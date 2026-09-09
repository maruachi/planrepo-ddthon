import { describe, expect, it } from 'vitest';
import { createProcessRig } from '@/tests/helpers/process-rig';

describe('ControlledProcessRunner', () => {
  it('does not finish on stdout and fails if stderr later exceeds its byte limit', async () => {
    const rig = createProcessRig();
    const execution = rig.start();
    rig.stdout(Buffer.from('{"type":"result","subtype":"success","is_error":false,"result":"{}"}'));
    rig.stdoutEnd();
    await rig.flush();
    expect(rig.resultSettled()).toBe(false);
    rig.stderr(Buffer.alloc(262_145));
    await rig.flush();
    expect(await execution.result).toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
    expect(execution.getObservationState().kind).not.toBe('Confirmed');
    rig.exit(0);
    rig.stderrEnd();
    rig.close(0);
    await rig.flush();
    expect(await execution.result).toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
  });

  it('exit 0과 두 pipe close와 child close가 모두 있어야 완료합니다', async () => {
    const rig = createProcessRig();
    const execution = rig.start();
    rig.stdout(Buffer.from('한글'));
    rig.stderr(Buffer.from('진단'));
    rig.exit(0);
    rig.stdoutEnd();
    rig.close(0);
    await rig.flush();
    expect(rig.resultSettled()).toBe(false);

    rig.stderrEnd();
    await expect(execution.result).resolves.toMatchObject({
      kind: 'Completed',
      stdout: Buffer.from('한글'),
      stderrByteCount: Buffer.byteLength('진단'),
      exitCode: 0,
      metrics: {
        startedAt: '2026-09-09T00:00:00.000Z',
        finishedAt: '2026-09-09T00:00:00.000Z',
        stdoutBytes: Buffer.byteLength('한글'),
        stderrBytes: Buffer.byteLength('진단'),
        stdoutClosed: true,
        stderrClosed: true,
        exitCode: 0,
      },
    });
  });

  it('stdout과 stderr의 raw byte 상한을 각각 허용하고 1 byte 초과는 실패합니다', async () => {
    const stdoutRig = createProcessRig();
    const stdoutExecution = stdoutRig.start();
    stdoutRig.stdout(Buffer.alloc(4_194_304));
    stdoutRig.stdout(Buffer.alloc(1));
    await expect(stdoutExecution.result).resolves.toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });

    const stderrRig = createProcessRig();
    const stderrExecution = stderrRig.start();
    stderrRig.stderr(Buffer.alloc(262_144));
    stderrRig.stdout(Buffer.from('{}'));
    stderrRig.exit(0);
    stderrRig.stdoutEnd();
    stderrRig.stderrEnd();
    stderrRig.close(0);
    await expect(stderrExecution.result).resolves.toMatchObject({ kind: 'Completed', stderrByteCount: 262_144 });
  });

  it('표준 deadline과 byte 상한을 늘린 실행 정책은 spawn 전에 거절합니다', async () => {
    const rig = createProcessRig();
    const execution = rig.start({
      limits: {
        stdinMaxBytes: 2_097_152,
        stdoutMaxBytes: 4_194_305,
        stderrMaxBytes: 262_144,
        timeoutMs: 300_000,
        terminationGraceMs: 2_000,
      },
    });

    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'POLICY_CONFLICT' });
    expect(execution.getObservationState()).toMatchObject({
      kind: 'Confirmed', result: { kind: 'no_process_created' },
    });
  });

  it('300000ms 경계는 완료할 수 있고 1ms 초과는 TIMEOUT입니다', async () => {
    const boundary = createProcessRig();
    const boundaryExecution = boundary.start();
    await boundary.flush();
    boundary.advance(300_000);
    boundary.stdout(Buffer.from('{}'));
    boundary.exit(0);
    boundary.stdoutEnd();
    boundary.stderrEnd();
    boundary.close(0);
    await expect(boundaryExecution.result).resolves.toMatchObject({
      kind: 'Completed', deadlineMono: 300_000, closedAtMono: 300_000,
    });

    const late = createProcessRig();
    const lateExecution = late.start();
    await late.flush();
    late.advance(300_001);
    await late.flush();
    await expect(lateExecution.result).resolves.toMatchObject({ kind: 'Failure', code: 'TIMEOUT' });
    expect(late.signals()).toEqual(['SIGTERM']);

    const jumped = createProcessRig();
    jumped.start();
    await jumped.flush();
    jumped.advance(302_001);
    await jumped.flush();
    expect(jumped.signals()).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('취소는 결과를 확정하되 TERM 뒤 2000ms 동안 같은 live handle일 때만 KILL합니다', async () => {
    const closed = createProcessRig();
    const closedExecution = closed.start();
    await closed.flush();
    closedExecution.requestStop('사용자 취소');
    await expect(closedExecution.result).resolves.toMatchObject({ kind: 'Failure', code: 'CANCELLED' });
    expect(closed.signals()).toEqual(['SIGTERM']);
    closed.exit(null, 'SIGTERM');
    closed.stdoutEnd();
    closed.stderrEnd();
    closed.close(null, 'SIGTERM');
    closed.advance(2_000);
    await closed.flush();
    expect(closed.signals()).toEqual(['SIGTERM']);

    const alive = createProcessRig();
    const aliveExecution = alive.start();
    await alive.flush();
    aliveExecution.requestStop('사용자 취소');
    alive.advance(2_000);
    await alive.flush();
    expect(alive.signals()).toEqual(['SIGTERM', 'SIGKILL']);
    expect(aliveExecution.getObservationState().kind).not.toBe('Confirmed');
  });

  it('direct child exit 뒤 pipe close가 지연돼도 이전 pid 범위에 추가 signal을 보내지 않습니다', async () => {
    const rig = createProcessRig();
    const execution = rig.start();
    await rig.flush();
    execution.requestStop('exit 뒤 signal 금지');
    expect(rig.signals()).toEqual(['SIGTERM']);

    rig.exit(0);
    rig.advance(2_000);
    await rig.flush();

    expect(rig.signals()).toEqual(['SIGTERM']);
    expect(execution.getObservationState()).toMatchObject({
      kind: 'Unknown', reason: 'execution_scope_not_proven',
      directProcess: { exitCode: 0, stdoutClosed: false, stderrClosed: false },
    });
  });

  it('spawn event 전에 요청한 취소도 handle이 live가 되는 즉시 종료를 시작합니다', async () => {
    const rig = createProcessRig();
    const execution = rig.start();
    execution.requestStop('spawn 경쟁 취소');
    expect(rig.signals()).toEqual([]);

    await rig.flush();
    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'CANCELLED' });
    expect(rig.signals()).toEqual(['SIGTERM']);
  });

  it('stdin backpressure를 drain까지 기다리고 입력 오류를 별도 실패로 확정합니다', async () => {
    const backpressured = createProcessRig({ stdinBackpressure: true });
    backpressured.start({ stdinBytes: Buffer.from('가'.repeat(100_000)) });
    await backpressured.flush();
    expect(backpressured.stdinEnded()).toBe(false);
    backpressured.stdinDrain();
    await backpressured.flush();
    expect(backpressured.stdinEnded()).toBe(true);

    const failed = createProcessRig();
    const execution = failed.start();
    failed.stdinError(new Error('EPIPE'));
    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'INPUT_ERROR' });
  });

  it('start 뒤 mutable limits와 stdin·argv·env를 바꿔도 소유 snapshot만 사용합니다', async () => {
    const limits = {
      stdinMaxBytes: 2_097_152,
      stdoutMaxBytes: 4_194_304,
      stderrMaxBytes: 262_144,
      timeoutMs: 300_000,
      terminationGraceMs: 2_000,
    };
    const stdinBytes = Buffer.from('원래 입력');
    const args = ['fixture.mjs', 'success'];
    const env = { PATH: '/original', FIXTURE_VALUE: 'original' };
    const rig = createProcessRig();
    const execution = rig.start({ limits, stdinBytes, args, env });

    limits.stdoutMaxBytes = 4_194_305;
    stdinBytes.fill(0x78);
    args[1] = 'ignore-term';
    env.FIXTURE_VALUE = 'mutated';
    await rig.flush();
    expect(rig.stdinBytes()).toEqual(Buffer.from('원래 입력'));
    expect(rig.spawnArgs()).toEqual(['fixture.mjs', 'success']);
    expect(rig.spawnEnv()).toMatchObject({ PATH: '/original', FIXTURE_VALUE: 'original' });

    rig.stdout(Buffer.alloc(4_194_305));
    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
  });

  it('ENOENT는 no_process_created로 확정하고 spawn crash gap은 Unknown으로 남깁니다', async () => {
    const missing = createProcessRig({ spawnError: Object.assign(new Error('missing'), { code: 'ENOENT' }) });
    const missingExecution = missing.start();
    await missing.flush();
    await expect(missingExecution.result).resolves.toMatchObject({ kind: 'Failure', code: 'EXECUTABLE_NOT_FOUND' });
    expect(missingExecution.getObservationState()).toMatchObject({
      kind: 'Confirmed', result: { kind: 'no_process_created' },
    });
    missing.stdoutEnd();
    missing.stderrEnd();
    missing.close(null);
    await missing.flush();
    expect(missingExecution.getObservationState()).toMatchObject({
      kind: 'Confirmed', result: { kind: 'no_process_created' },
    });

    const crashGap = createProcessRig({ spawnThrows: new Error('spawn crashed') });
    const crashExecution = crashGap.start();
    await expect(crashExecution.result).resolves.toMatchObject({ kind: 'Failure', code: 'SPAWN_ERROR' });
    expect(crashExecution.getObservationState()).toMatchObject({ kind: 'Unknown', reason: 'spawn_crash_gap' });
  });

  it('nonzero와 pipe IO 오류를 완료로 바꾸지 않고 늦은 close 관찰을 알립니다', async () => {
    const rig = createProcessRig();
    const execution = rig.start();
    rig.exit(7);
    await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: 'PROCESS_FAILED', exitCode: 7 });
    rig.pipeError('stdout', new Error('read failed'));
    rig.stdoutEnd();
    rig.stderrEnd();
    rig.close(7);
    await rig.flush();
    expect(await execution.result).toMatchObject({ kind: 'Failure', code: 'PROCESS_FAILED' });
    expect(rig.observations().at(-1)).toMatchObject({ kind: 'Unknown', reason: 'execution_scope_not_proven' });
  });

  it('늦은 close 관찰 뒤 timer와 runner listener를 모두 정리합니다', async () => {
    const rig = createProcessRig();
    const execution = rig.start();
    await rig.flush();
    rig.stdout(Buffer.from('{}'));
    rig.exit(0);
    rig.stdoutEnd();
    rig.stderrEnd();
    rig.close(0);
    await execution.result;
    await rig.flush();

    expect(rig.pendingTimers()).toBe(0);
    expect(rig.listenerCount()).toBe(0);
  });

  it('결과 확정 시점의 정제된 metrics를 고정하고 늦은 관찰로 소급 변경하지 않습니다', async () => {
    const rig = createProcessRig();
    const execution = rig.start();
    await rig.flush();
    rig.stdout(Buffer.from('결과'));
    rig.stderr(Buffer.from('진단'));
    rig.advance(25);
    execution.requestStop('사용자 취소');

    const result = await execution.result;
    expect(result).toMatchObject({
      kind: 'Failure',
      code: 'CANCELLED',
      metrics: {
        startedAt: '2026-09-09T00:00:00.000Z',
        finishedAt: '2026-09-09T00:00:00.025Z',
        stdoutBytes: Buffer.byteLength('결과'),
        stderrBytes: Buffer.byteLength('진단'),
        stdoutClosed: false,
        stderrClosed: false,
      },
    });

    rig.exit(null, 'SIGTERM');
    rig.stdoutEnd();
    rig.stderrEnd();
    rig.close(null, 'SIGTERM');
    await rig.flush();

    expect(await execution.result).toEqual(result);
    expect(result.metrics).not.toHaveProperty('terminationSignal');
  });
});
