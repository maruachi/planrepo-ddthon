import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiClient } from '../../../src/shared/client/api-client.js';
import type { WorktreeSpikeView } from '../../../src/worktree-spike/contracts.js';
import { isWorktreeInteractionActive, shouldSubmitInteractionMessage, WorktreeInteraction } from '../../../src/worktree-spike/ui/WorktreeSpikePanel.js';
import { isWorktreeDocumentEditResult, isWorktreeDocumentVersionPage, isWorktreeDocumentView, isWorktreeSpikeView, WorktreeSpikeClient } from '../../../src/worktree-spike/ui/worktree-spike-client.js';

const view = {
  srId: 'sr/one', configured: true, readiness: 'ready', branch: 'planrepo/sr/sr-one',
  worktreeRoot: '/tmp/worktrees/sr-one', currentStage: 'Code Generation', firstIncomplete: 'Step 5',
  runStatus: 'idle', changedPaths: ['aidlc-docs/aidlc-state.md'],
  sessionId: '11111111-1111-4111-8111-111111111111', interactionStatus: 'awaiting_input',
  transcript: [{ sequence: 1, role: 'assistant', text: '진행할까요?', createdAt: '2026-09-09T00:00:00.000Z' }],
  documents: [{ srId: 'sr/one', path: 'aidlc-docs/aidlc-state.md', change: 'modified', hash: 'a'.repeat(64), versionId: 'v1', versionNumber: 1, origin: 'ai_generated', createdAt: '2026-09-09T00:00:00.000Z', editable: false }],
};
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('strict guard accepts a complete view and rejects malformed or unknown fields', () => {
  expect(isWorktreeSpikeView(view)).toBe(true);
  expect(isWorktreeSpikeView({ ...view, configured: 'yes' })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, readiness: 'unknown' })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, changedPaths: ['valid', 42] })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, documents: [{ ...view.documents[0], hash: 'invalid' }] })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, unexpected: true })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, firstIncomplete: null })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, interactionStatus: 'paused' })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, transcript: [{ ...view.transcript[0], sequence: 0 }] })).toBe(false);
  expect(isWorktreeSpikeView({ ...view, transcript: [{ ...view.transcript[0], unknown: true }] })).toBe(false);
  const { sessionId: _sessionId, interactionStatus: _interactionStatus, transcript: _transcript, ...legacy } = view;
  expect(isWorktreeSpikeView(legacy)).toBe(true);
});

test('document encodes its managed path and validates the returned body', async () => {
  const calls: string[] = [];
  const document = { ...view.documents[0], body: '# State\n', isLatest: true };
  const client = new WorktreeSpikeClient(new ApiClient(async path => { calls.push(String(path)); return response(document); }));

  await expect(client.document('sr/one', 'aidlc-docs/a b.md')).resolves.toEqual(document);
  expect(calls).toEqual(['/api/srs/sr%2Fone/worktree-spike/document?path=aidlc-docs%2Fa%20b.md']);
  expect(isWorktreeDocumentView({ ...document, body: 42 })).toBe(false);
});

test('reads an encoded historical version, lists guarded versions, and posts an idempotent edit request', async () => {
  const calls: { path: string; init?: RequestInit }[] = []; const document = { ...view.documents[0], body: '# State\n', isLatest: true };
  const version = Object.fromEntries(Object.entries(view.documents[0]).filter(([key]) => !['change', 'editable'].includes(key)));
  const page = { items: [version], nextCursor: null };
  const client = new WorktreeSpikeClient(new ApiClient(async (path, init) => {
    calls.push({ path: String(path), init });
    return response(String(path).endsWith('/edits') ? { view: document, changed: true } : String(path).includes('/versions?') ? page : document);
  }), () => '33333333-3333-4333-8333-333333333333');
  await expect(client.document('sr/one', 'aidlc-docs/a b.md', '44444444-4444-4444-8444-444444444444')).resolves.toEqual(document);
  await expect(client.versions('sr/one', 'aidlc-docs/a b.md')).resolves.toEqual(page);
  await expect(client.edit('sr/one', { path: 'aidlc-docs/a b.md', expectedHash: 'a'.repeat(64), body: '# edit\n' })).resolves.toMatchObject({ changed: true });
  expect(calls.map(call => call.path)).toEqual([
    '/api/srs/sr%2Fone/worktree-spike/document?path=aidlc-docs%2Fa%20b.md&versionId=44444444-4444-4444-8444-444444444444',
    '/api/srs/sr%2Fone/worktree-spike/document/versions?path=aidlc-docs%2Fa%20b.md',
    '/api/srs/sr%2Fone/worktree-spike/document/edits',
  ]);
  expect(calls[2].init).toMatchObject({ method: 'POST', body: JSON.stringify({ path: 'aidlc-docs/a b.md', expectedHash: 'a'.repeat(64), body: '# edit\n' }) });
  expect((calls[2].init?.headers as Record<string, string>)['X-Operation-Id']).toBe('33333333-3333-4333-8333-333333333333');
  expect(isWorktreeDocumentVersionPage({ ...page, items: [{ ...version, versionNumber: 0 }] })).toBe(false);
  expect(isWorktreeDocumentEditResult({ view: document, changed: 'yes' })).toBe(false);
});

test('status encodes the SR id and performs a guarded GET', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = new WorktreeSpikeClient(new ApiClient(async (path, init) => { calls.push({ path: String(path), init }); return response(view); }));

  await expect(client.status('sr/one')).resolves.toEqual(view);
  expect(calls[0].path).toBe('/api/srs/sr%2Fone/worktree-spike');
  expect(calls[0].init?.method).toBeUndefined();
});

test('interactive mutations send guarded JSON with a fresh operation id', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const ids = Array.from({ length: 5 }, (_, index) => `${index + 1}1111111-1111-4111-8111-111111111111`);
  const client = new WorktreeSpikeClient(
    new ApiClient(async (path, init) => { calls.push({ path: String(path), init }); return response(view); }),
    () => ids.shift()!,
  );

  await client.provision('sr/one');
  await client.resume('sr/one');
  await client.message('sr/one', '진행해줘.');
  await client.finish('sr/one');
  await client.cancel('sr/one');
  expect(calls.map(call => call.path)).toEqual([
    '/api/srs/sr%2Fone/worktree-spike/provision',
    '/api/srs/sr%2Fone/worktree-spike/resume',
    '/api/srs/sr%2Fone/worktree-spike/message',
    '/api/srs/sr%2Fone/worktree-spike/finish',
    '/api/srs/sr%2Fone/worktree-spike/cancel',
  ]);
  expect(calls.map(call => call.init?.method)).toEqual(Array(5).fill('POST'));
  expect(calls.map(call => call.init?.body)).toEqual(['{}', '{}', JSON.stringify({ message: '진행해줘.' }), '{}', '{}']);
  expect(calls.every(call => (call.init?.headers as Record<string, string>)['Content-Type'] === 'application/json')).toBe(true);
  expect(new Set(calls.map(call => (call.init?.headers as Record<string, string>)['X-Operation-Id'])).size).toBe(5);
});

test('client rejects a malformed success response before UI consumption', async () => {
  const client = new WorktreeSpikeClient(new ApiClient(async () => response({ ...view, runStatus: 'unknown' })));
  await expect(client.status('sr-1')).rejects.toThrow('Malformed success');
});

test('interactive UI renders ordered transcript controls and keyboard semantics', () => {
  const interactive = { ...view, transcript: [
    { sequence: 2, role: 'assistant', text: '두 번째', createdAt: '2026-09-09T00:00:01.000Z' },
    { sequence: 1, role: 'user', text: '첫 번째', createdAt: '2026-09-09T00:00:00.000Z' },
  ] } as WorktreeSpikeView;
  const client = new WorktreeSpikeClient(new ApiClient(async () => response(interactive)));
  const html = renderToStaticMarkup(createElement(WorktreeInteraction, { srId: 'sr/one', view: interactive, client, update: () => {} }));
  expect(html).toContain('data-testid="worktree-interaction-transcript"');
  expect(html).toContain('data-testid="worktree-interaction-message-input"');
  expect(html).toContain('data-testid="worktree-interaction-send-button"');
  expect(html).toContain('data-testid="worktree-interaction-finish-button"');
  expect(html).toContain('data-testid="worktree-interaction-cancel-button"');
  expect(html.indexOf('첫 번째')).toBeLessThan(html.indexOf('두 번째'));
  expect(isWorktreeInteractionActive('awaiting_input')).toBe(true);
  expect(isWorktreeInteractionActive('succeeded')).toBe(false);
  expect(shouldSubmitInteractionMessage('Enter', false)).toBe(true);
  expect(shouldSubmitInteractionMessage('Enter', true)).toBe(false);
  expect(shouldSubmitInteractionMessage('Enter', false, true)).toBe(false);
});
