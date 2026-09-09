import { expect, test } from 'vitest';
import { ApiClient, isSR } from '../../src/shared/client/api-client.js';
import { OperationTracker } from '../../src/shared/client/operation-tracker.js';
import { beginEdit, editDraft, isDirty, refreshEditor } from '../../src/sr-document-foundation/ui/editor-state.js';
import { CompareGeneration, textPage } from '../../src/sr-document-foundation/ui/compare-state.js';
import type { DocumentView } from '../../src/shared/contracts.js';
import { readAttachment } from '../../src/sr-document-foundation/ui/attachment.js';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
test('lost response checks once, keeps unknown and never automatically resubmits', async () => {
  const calls: RequestInit[] = []; const client = new ApiClient(async (_url, init) => { calls.push(init ?? {}); if (init?.method === 'POST') throw new Error('lost'); return response({ ok: true, data: { status: 'unknown' } }); });
  const tracker = new OperationTracker(client); await tracker.submit('/api/srs', { title: 'draft', description: 'original' });
  expect(tracker.state.status).toBe('unknown'); expect(calls.filter(x => x.method === 'POST')).toHaveLength(1);
  await tracker.submit('/api/srs', { title: 'draft', description: 'original' }); expect(calls).toHaveLength(2);
  await tracker.check(); expect(calls.filter(x => x.method === 'POST')).toHaveLength(1);
});
test('malformed success is uncertain; committed receipt resolves exact original SR', async () => {
  let calls = 0; const sr = { id: 'exact-id', title: 'draft', description: 'original', createdAt: 'now', column: 'sr_list' };
  const tracker = new OperationTracker(new ApiClient(async () => { calls++; return calls === 1 ? response({ ok: true, data: {} }) : calls === 2 ? response({ ok: true, data: { status: 'committed', receipt: { kind: 'create', srId: sr.id, changed: true } } }) : response({ ok: true, data: sr }); }));
  await tracker.submit('/api/srs', { title: 'draft', description: 'original' }); expect(tracker.state).toMatchObject({ status: 'succeeded', data: sr }); expect(calls).toBe(3);
});
test('conflict and rejected request remain explicit while malformed query fails', async () => {
  const tracker = new OperationTracker(new ApiClient(async () => response({ ok: false, error: { code: 'VERSION_CONFLICT', message: 'stale' } }, 409)));
  await tracker.submit('/api/srs/x/documents/y/edits', { body: 'draft' }); expect(tracker.state.status).toBe('conflict');
  const client = new ApiClient(async () => response({ ok: true, data: {} })); await expect(client.request('/api/srs/x', isSR)).rejects.toThrow('Malformed');
});
test('query refresh cannot overwrite editor draft and stale comparison generations are rejected', () => {
  const view = { srId: 's', documentId: 'd', versionId: 'v1', body: 'original' } as DocumentView;
  const state = editDraft(beginEdit(view), 'my draft'); expect(isDirty(state)).toBe(true);
  expect(refreshEditor(state, { ...view, versionId: 'v2', body: 'new' })).toEqual(state);
  const g = new CompareGeneration(); const old = g.next(); const current = g.next(); expect(g.accepts(old)).toBe(false); expect(g.accepts(current)).toBe(true);
});
test('text pagination preserves CRLF and final lines at exact display boundaries', () => {
  const body = '한글\r\n'.repeat(200) + '마지막'; const first = textPage(body, 0); const second = textPage(body, 1);
  expect(first.lines).toHaveLength(200); expect(first.total).toBe(201); expect(first.lines[199].ending).toBe('CRLF'); expect(second.lines).toEqual([{ number: 201, text: '마지막', ending: '끝 개행 없음' }]);
  expect(textPage('', 0)).toEqual({ lines: [], total: 0 }); expect(textPage('x'.repeat(1048576), 0).lines[0].text.length).toBe(1048576);
});
test('attachment decoder rejects invalid UTF-8 and preserves explicit BOM and CRLF', async () => {
  await expect(readAttachment(new File([new Uint8Array([0xc3])], 'bad.md'))).rejects.toMatchObject({ detail: { code: 'VALIDATION_ERROR' } });
  const original = '\ufeff한글\r\n';
  expect(await readAttachment(new File([new TextEncoder().encode(original)], 'valid.md'))).toBe(original);
  await expect(readAttachment(new File([new Uint8Array(1048577)], 'large.md'))).rejects.toMatchObject({ detail: { code: 'PAYLOAD_TOO_LARGE' } });
});
