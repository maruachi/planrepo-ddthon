import { expect, test } from 'vitest';
import { RESUME_PROMPT, type RunRequest } from '../../../src/worktree-spike/contracts.js';
import { WorktreeAidlcRunner, type WorktreeLauncherRequest } from '../../../src/worktree-spike/runner/worktree-aidlc-runner.js';

const request = (prompt: RunRequest['prompt'] = RESUME_PROMPT): RunRequest => ({
  srId: 'sr-1',
  worktreeRoot: '/tmp/managed-worktrees/sr-1',
  prompt,
  operationId: '11111111-1111-4111-8111-111111111111',
});

test('passes the exact resume prompt and worktree cwd to a shell-free launcher', async () => {
  let captured: WorktreeLauncherRequest | undefined;
  const runner = new WorktreeAidlcRunner({
    executable: '/fake/claude',
    launcher: async input => { captured = input; return { exitCode: 0, stdout: 'completed' }; },
  });

  await expect(runner.run(request())).resolves.toEqual({ exitCode: 0, stdout: 'completed' });
  expect(captured).toMatchObject({
    executable: '/fake/claude',
    cwd: '/tmp/managed-worktrees/sr-1',
    input: RESUME_PROMPT,
    shell: false,
    args: ['--print', '--output-format', 'text', '--no-session-persistence'],
  });
  await runner.close();
});

test('rejects a modified prompt before launching a child', async () => {
  let launches = 0;
  const runner = new WorktreeAidlcRunner({ launcher: async () => { launches++; return { exitCode: 0, stdout: '' }; } });
  const changed = request('continue from somewhere else' as typeof RESUME_PROMPT);

  await expect(runner.run(changed)).rejects.toMatchObject({ code: 'INVALID_PROMPT' });
  expect(launches).toBe(0);
  await runner.close();
});

test('close cancels an in-flight launch and prevents future runs', async () => {
  const runner = new WorktreeAidlcRunner({
    launcher: input => new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'CLI_CANCELLED' })), { once: true });
    }),
  });
  const pending = runner.run(request());
  await runner.close();

  await expect(pending).rejects.toMatchObject({ code: 'CLI_CANCELLED' });
  await expect(runner.run(request())).rejects.toMatchObject({ code: 'CLI_CANCELLED' });
});
