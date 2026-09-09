import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testServer } from './helpers/test-server.js';
import { unwrap } from '../../src/shared/errors.js';
import { AUTHOR, type LocalCommand } from '../../src/shared/contracts.js';
test('lost create response resolves from receipt; replay never creates a second SR', async () => {
  const t = await testServer(true); const operationId = randomUUID(); const body = { title: '응답 유실', description: '원문' };
  try {
    await expect(t.post('/api/srs', body, operationId)).rejects.toThrow();
    const status = (await (await fetch(`${t.base}/api/operations/${operationId}`)).json()).data; expect(status.status).toBe('committed');
    const replay = await t.post('/api/srs', body, operationId); expect((await replay.json()).data.id).toBe(status.receipt.srId);
    expect(unwrap(t.sr.listBoard()).items).toHaveLength(1);
    expect((await t.post('/api/srs', { ...body, description: 'changed' }, operationId)).status).toBe(409);
    expect((await (await fetch(`${t.base}/api/operations/${randomUUID()}`)).json()).data.status).toBe('unknown');
  } finally { await t.stop(); }
});
test('original edit receipt wins over current latest validation even after later edits', async () => {
  const t = await testServer(); try {
    const s = unwrap(t.sr.create({ title: 'SR', description: 'x' }, AUTHOR)); const changes = unwrap(t.docs.prepareGenerated(s.id, randomUUID(), [{ logicalKey: 'p', title: 'p', body: 'v1' }])); unwrap(t.store.commit(changes)); const ref = changes.pointers[0];
    const path = `/api/srs/${s.id}/documents/${ref.documentId}/edits`; const operationId = randomUUID(); const body = { versionId: ref.versionId, body: 'v2' };
    const first = (await (await t.post(path, body, operationId)).json()).data; unwrap(t.docs.edit(first.view, 'v3', AUTHOR));
    const replay = (await (await t.post(path, body, operationId)).json()).data; expect(replay.view.versionId).toBe(first.view.versionId); expect(replay.view.body).toBe('v2'); expect(replay.view.isLatest).toBe(false);
    expect(unwrap(t.docs.listVersions(s.id, ref.documentId)).items).toHaveLength(3);
  } finally { await t.stop(); }
});
test('in-progress and post-prepare failure replay use the same operation contract', async () => {
  const t = await testServer(); try {
    const command: LocalCommand = { kind: 'create', input: { title: 'pending', description: 'x' } }; const context = t.boundary.operations.context(randomUUID(), command, AUTHOR);
    let release!: () => void; const hold = new Promise<void>(r => { release = r; });
    const pending = t.boundary.operations.execute(context, async () => { await hold; return t.sr.create(command.input, AUTHOR, context); });
    expect(unwrap(t.boundary.operations.status(context.operationId)).status).toBe('in_progress');
    expect(await t.boundary.operations.execute(context, () => t.sr.create(command.input, AUTHOR))).toMatchObject({ ok: false, error: { code: 'IN_PROGRESS' } }); release(); expect((await pending).ok).toBe(true);
    const second = { ...context, operationId: randomUUID() };
    const outcome = await t.boundary.operations.execute(second, () => { unwrap(t.sr.create(command.input, AUTHOR, second)); return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'fixture race' } }; }); expect(outcome.ok).toBe(true);
  } finally { await t.stop(); }
});
