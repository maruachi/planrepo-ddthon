import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { services } from '../sr-document-foundation/helpers/test-db.js';
import { LocalAppBoundary } from '../../src/sr-document-foundation/http/boundary.js';
import { routes } from '../../src/sr-document-foundation/http/routes.js';
import { PlanningContextBuilder } from '../../src/aidlc-planning/context/planning-context-builder.js';
import { PlanningService } from '../../src/aidlc-planning/services/planning-service.js';
import type { PlanRunnerPort } from '../../src/shared/planning-contracts.js';

async function planningServer(dropAdvance = false) {
  const t = services();
  const execute = vi.fn<PlanRunnerPort['execute']>(async () => ({ ok: true, data: { artifacts: [{ logicalKey: 'requirements', title: '요구사항', body: 'HTTP에서 생성한 계획' }], questions: [], summary: '검토 준비' } }));
  const planning = new PlanningService(t.store, t.docs, new PlanningContextBuilder(t.store, resolve('.aidlc-rule-details')), { execute });
  const app = express();
  if (dropAdvance) app.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = body => { if (dropAdvance && req.path.endsWith('/planning/advance') && body?.ok) { dropAdvance = false; res.destroy(); return res; } return json(body); }; next();
  });
  app.use('/api', routes(new LocalAppBoundary(t.sr, t.docs, t.store), planning));
  const server = createServer(app);
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { await planning.close(); t.close(); throw error; }
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected local test address');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, operationId = randomUUID()) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId }, body: JSON.stringify(body) });
  const createSR = async () => { const response = await post('/api/srs', { title: 'HTTP planning', description: '계획 작성' }); expect(response.status).toBe(201); return (await response.json()).data.id as string; };
  return { ...t, base, post, createSR, planning, execute, stop: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await planning.close(); t.close(); } };
}

test('planning HTTP stores generation, exposes receipt/run, and rejects cross-SR access and stale decisions', async () => {
  const t = await planningServer();
  try {
    const srId = await t.createSR(); const other = await t.createSR(); const op = randomUUID();
    const started = await t.post(`/api/srs/${srId}/planning/advance`, { action: 'generate', revision: 0 }, op);
    expect(started.status).toBe(202); const run = (await started.json()).data; expect(run.status).toBe('running');
    await t.planning.waitForIdle();
    const loaded = await fetch(`${t.base}/api/srs/${srId}/runs/${run.id}`);
    expect(loaded.status).toBe(200); expect(loaded.headers.get('cache-control')).toBe('no-store');
    expect((await loaded.json()).data).toMatchObject({ id: run.id, status: 'succeeded', outputRefs: [expect.objectContaining({ srId })] });
    const receipt = await (await fetch(`${t.base}/api/operations/${op}`)).json();
    expect(receipt.data).toMatchObject({ status: 'committed', receipt: { operationId: op, runId: run.id, srId } });
    const forbidden = await fetch(`${t.base}/api/srs/${other}/runs/${run.id}`); expect(forbidden.status).toBe(400); expect((await forbidden.json()).error.code).toBe('REFERENCE_MISMATCH');
    const workflow = (await (await fetch(`${t.base}/api/srs/${srId}/workflow`)).json()).data;
    expect(workflow.status).toBe('awaiting_approval'); expect(workflow.reviewTargets).toHaveLength(1);
    const ref = workflow.reviewTargets[0];
    const edited = await t.post(`/api/srs/${srId}/documents/${ref.documentId}/edits`, { versionId: ref.versionId, body: '사용자 편집' }); expect(edited.status).toBe(200);
    const stale = await t.post(`/api/srs/${srId}/planning/decisions`, { kind: 'approve', comment: '', targets: workflow.reviewTargets, revision: workflow.revision });
    expect(stale.status).toBe(409); expect((await stale.json()).error.code).toBe('VERSION_CONFLICT');
    const updated = (await (await fetch(`${t.base}/api/srs/${srId}/workflow`)).json()).data;
    expect((await t.post(`/api/srs/${srId}/planning/decisions`, { kind: 'approve', comment: '', targets: updated.reviewTargets, revision: updated.revision })).status).toBe(200);
    expect(t.execute).toHaveBeenCalledTimes(1);
  } finally { await t.stop(); }
});

test('lost planning response is recovered through receipt and same-operation replay without another CLI call', async () => {
  const t = await planningServer(true);
  try {
    const srId = await t.createSR(); const op = randomUUID(); const body = { action: 'generate', revision: 0 }; const path = `/api/srs/${srId}/planning/advance`;
    await expect(t.post(path, body, op)).rejects.toThrow(); await t.planning.waitForIdle();
    const receipt = (await (await fetch(`${t.base}/api/operations/${op}`)).json()).data;
    expect(receipt.status).toBe('committed'); expect(receipt.receipt.runId).toBeTruthy();
    const replay = await t.post(path, body, op); expect(replay.status).toBe(202); expect((await replay.json()).data.id).toBe(receipt.receipt.runId);
    expect(t.execute).toHaveBeenCalledTimes(1);
    const changedPayload = await t.post(path, { action: 'revise', revision: 0 }, op);
    expect(changedPayload.status).toBe(409); expect((await changedPayload.json()).error.code).toBe('OPERATION_CONFLICT');
    const documents = (await (await fetch(`${t.base}/api/srs/${srId}/documents`)).json()).data.items;
    expect(documents).toHaveLength(1); expect(documents[0].versionNumber).toBe(1);
  } finally { await t.stop(); }
});

test('planning HTTP rejects malformed JSON, invalid revisions, unknown fields, and non-string decision kinds', async () => {
  const t = await planningServer();
  try {
    const srId = await t.createSR(); const prefix = `/api/srs/${srId}/planning`;
    for (const revision of [-1, 0.5, '0', null]) expect((await t.post(`${prefix}/advance`, { action: 'generate', revision })).status).toBe(400);
    expect((await t.post(`${prefix}/advance`, { action: 'generate', revision: 0, command: 'shell' })).status).toBe(400);
    for (const finalize of ['true', 1, null]) expect((await t.post(`${prefix}/advance`, { action: 'generate', revision: 0, finalize })).status).toBe(400);
    for (const kind of [['approve'], { toString: 'approve' }, null, 'unknown']) expect((await t.post(`${prefix}/decisions`, { kind, comment: '', targets: [], revision: 0 })).status).toBe(400);
    const malformed = await fetch(t.base + prefix + '/advance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': randomUUID() }, body: '{bad' });
    expect(malformed.status).toBe(400); expect((await malformed.json()).error.code).toBe('VALIDATION_ERROR');
    expect(t.execute).not.toHaveBeenCalled();
    expect((await t.post(`${prefix}/advance`, { action: 'generate', revision: 1 })).status).toBe(409);
  } finally { await t.stop(); }
});
