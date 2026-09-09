import { expect, test } from 'vitest';
import { ApiClient } from '../../../src/shared/client/api-client.js';
import { isWorktreeSpikeView, WorktreeSpikeClient } from '../../../src/worktree-spike/ui/worktree-spike-client.js';

const view = {
  srId: 'sr/one', configured: true, readiness: 'ready', branch: 'planrepo/sr/sr-one',
  worktreeRoot: '/tmp/worktrees/sr-one', currentStage: 'Code Generation', firstIncomplete: 'Step 5',
  runStatus: 'idle', changedPaths: ['aidlc-docs/aidlc-state.md'],
};
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('strict guard accepts a complete view and rejects malformed or unknown fields', () => {
  expect(isWorktreeSpikeView(view)).toBe(true);
  expect(isWorktreeSpikeView({ ...view, configured: 'yes' })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, readiness: 'unknown' })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, changedPaths: ['valid', 42] })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, unexpected: true })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, firstIncomplete: null })).toBe(false);
});

test('status encodes the SR id and performs a guarded GET', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = new WorktreeSpikeClient(new ApiClient(async (path, init) => { calls.push({ path: String(path), init }); return response(view); }));

  await expect(client.status('sr/one')).resolves.toEqual(view);
  expect(calls[0].path).toBe('/api/srs/sr%2Fone/worktree-spike');
  expect(calls[0].init?.method).toBeUndefined();
});

test('provision and resume send JSON with a fresh operation id', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const client = new WorktreeSpikeClient(
    new ApiClient(async (path, init) => { calls.push({ path: String(path), init }); return response(view); }),
    () => ids.shift()!,
  );

  await client.provision('sr/one');
  await client.resume('sr/one');
  expect(calls.map(call => call.path)).toEqual([
    '/api/srs/sr%2Fone/worktree-spike/provision',
    '/api/srs/sr%2Fone/worktree-spike/resume',
  ]);
  expect(calls.map(call => call.init?.method)).toEqual(['POST', 'POST']);
  expect(calls.map(call => call.init?.body)).toEqual(['{}', '{}']);
  expect(calls.map(call => (call.init?.headers as Record<string, string>)['Content-Type'])).toEqual(['application/json', 'application/json']);
  expect(calls.map(call => (call.init?.headers as Record<string, string>)['X-Operation-Id'])).toEqual([
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);
});

test('client rejects a malformed success response before UI consumption', async () => {
  const client = new WorktreeSpikeClient(new ApiClient(async () => response({ ...view, runStatus: 'unknown' })));
  await expect(client.status('sr-1')).rejects.toThrow('Malformed success');
});
