import { expect, test, vi } from 'vitest';
import { RESUME_PROMPT, WORKTREE_RUN_TIMEOUT_MS, type InteractiveRunRequest, type WorktreeRunHandle } from '../../../src/worktree-spike/contracts.js';
import { WorktreeAidlcRunner, type WorktreeLauncherRequest } from '../../../src/worktree-spike/runner/worktree-aidlc-runner.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const request = (resume = false): InteractiveRunRequest => ({
  srId: 'sr-1',
  worktreeRoot: '/tmp/managed-worktrees/sr-1',
  prompt: RESUME_PROMPT,
  operationId: '22222222-2222-4222-8222-222222222222',
  sessionId,
  resume,
});

function fakeHandle(id = sessionId): WorktreeRunHandle {
  return { sessionId: id, completion: Promise.resolve({ exitCode: 0, stdout: '' }), send: vi.fn(async () => {}), finish: vi.fn(), cancel: vi.fn() };
}

test('starts new and resumed duplex sessions with frozen arguments', async () => {
  const captured: WorktreeLauncherRequest[] = [];
  const runner = new WorktreeAidlcRunner({ executable: '/fake/claude', launcher: input => { captured.push(input); return fakeHandle(); } });
  expect(runner.start(request(), vi.fn())).toMatchObject({ sessionId });
  expect(runner.start(request(true), vi.fn())).toMatchObject({ sessionId });
  expect(captured).toMatchObject({
    0: { executable: '/fake/claude', cwd: '/tmp/managed-worktrees/sr-1', input: RESUME_PROMPT, sessionId, shell: false, args: ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--session-id', sessionId], timeoutMs: WORKTREE_RUN_TIMEOUT_MS },
    1: { args: ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--resume', sessionId] },
  });
  await runner.close();
});

test('forwards stream events and rejects modified prompts or invalid sessions', async () => {
  const observed = vi.fn(); const launcher = vi.fn((input: WorktreeLauncherRequest) => { input.onEvent({ role: 'assistant', text: '계속합니다.' }); return fakeHandle(); });
  const runner = new WorktreeAidlcRunner({ launcher }); runner.start(request(), observed);
  expect(observed).toHaveBeenCalledWith({ role: 'assistant', text: '계속합니다.' });
  expect(() => runner.start({ ...request(), prompt: ' ' }, vi.fn())).toThrowError(expect.objectContaining({ code: 'INVALID_PROMPT' }));
  expect(() => runner.start({ ...request(), sessionId: 'bad' }, vi.fn())).toThrowError(expect.objectContaining({ code: 'INVALID_SESSION' }));
  expect(launcher).toHaveBeenCalledOnce(); await runner.close();
});

test('close cancels an in-flight launch and prevents future runs', async () => {
  let rejectCompletion!: (error: Error) => void; const completion = new Promise<never>((_resolve, reject) => { rejectCompletion = reject; });
  const cancel = vi.fn(() => rejectCompletion(Object.assign(new Error('cancelled'), { code: 'CLI_CANCELLED' })));
  const runner = new WorktreeAidlcRunner({ launcher: input => { input.signal.addEventListener('abort', cancel, { once: true }); return { ...fakeHandle(), completion }; } });
  const handle = runner.start(request(), vi.fn()); await runner.close();
  await expect(handle.completion).rejects.toMatchObject({ code: 'CLI_CANCELLED' });
  expect(cancel).toHaveBeenCalledOnce(); expect(() => runner.start(request(), vi.fn())).toThrowError(expect.objectContaining({ code: 'CLI_CANCELLED' }));
});
