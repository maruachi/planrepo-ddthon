import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testServer } from './helpers/test-server.js';
import { unwrap } from '../../src/shared/errors.js';
test('real HTTP covers SR, metadata, exact versions, editing, restoration, compare and history', async () => {
  const t = await testServer(); try {
    const created = await t.post('/api/srs', { title: 'HTTP SR', description: '한글\r\n', attachmentMarkdown: '' }); expect(created.status).toBe(201);
    const s = (await created.json()).data; expect(s.attachmentMarkdown).toBe('');
    const changes = unwrap(t.docs.prepareGenerated(s.id, randomUUID(), [{ logicalKey: 'plan', title: '계획', body: 'v1\n' }])); unwrap(t.store.commit(changes)); const ref = changes.pointers[0]; const docPath = `/api/srs/${s.id}/documents/${ref.documentId}`;
    const edited = await t.post(docPath + '/edits', { versionId: ref.versionId, body: 'v2\n' }); expect(edited.status).toBe(200); const v2 = (await edited.json()).data.view;
    const paths = ['/api/config', '/api/board', `/api/srs/${s.id}`, `/api/srs/${s.id}/documents`, docPath + '/versions', docPath + `/versions/${ref.versionId}`, `/api/srs/${s.id}/history`, docPath + `/compare?left=${ref.versionId}&right=${v2.versionId}`];
    for (const path of paths) { const response = await fetch(t.base + path); expect(response.status, path).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).ok).toBe(true); }
    const events = unwrap(t.docs.listHistory(s.id)).items; expect((await fetch(`${t.base}/api/srs/${s.id}/history/${events[0].id}`)).status).toBe(200);
    const restored = (await (await t.post(docPath + '/restorations', { versionId: ref.versionId })).json()).data.view; expect(restored.body).toBe('v1\n'); expect(restored.versionNumber).toBe(3);
    expect((await t.post(docPath + '/edits', { versionId: ref.versionId, body: 'stale' })).status).toBe(409);
    expect((await fetch(t.base + '/api/missing')).status).toBe(404);
  } finally { await t.stop(); }
});
test('HTTP rejects malformed/oversized input and preserves stored data', async () => {
  const t = await testServer(); try {
    expect((await t.post('/api/srs', { title: ' ', description: 'x' })).status).toBe(400);
    expect((await t.post('/api/srs', { title: 'x', description: 'x', column: 'implemented' })).status).toBe(400);
    expect((await t.post('/api/srs', { title: 'x', description: 'x'.repeat(1048577) })).status).toBe(413);
    const oversizedJSON = await t.post('/api/srs', { title: 'x', description: 'x'.repeat(16777216) });
    expect(oversizedJSON.status).toBe(413);
    expect((await oversizedJSON.json()).error.message).toContain('JSON 요청 크기');
    for (const [headers, body, status] of [[{ 'Content-Type': 'application/json' }, '{bad', 400], [{ 'Content-Type': 'text/plain' }, '{}', 415], [{ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, '{}', 415]] as const) {
      const r = await fetch(t.base + '/api/srs', { method: 'POST', headers: { ...headers, 'X-Operation-Id': randomUUID() }, body }); expect(r.status).toBe(status); expect((await r.json()).ok).toBe(false);
    }
    expect((await fetch(t.base + '/api/board?limit=101')).status).toBe(400);
    expect((await fetch(t.base + '/api/board', { headers: { Origin: 'http://other.invalid' } })).ok).toBe(false);
    expect(unwrap(t.sr.listBoard()).items).toEqual([]);
  } finally { await t.stop(); }
});
