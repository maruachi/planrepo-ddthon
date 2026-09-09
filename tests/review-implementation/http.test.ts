import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { AUTHOR } from '../../src/shared/contracts.js';
import { unwrap } from '../../src/shared/errors.js';
import { initialWorkflow } from '../../src/aidlc-planning/policy/planning-policy.js';
import { PlanningService } from '../../src/aidlc-planning/services/planning-service.js';
import { PlanningContextBuilder } from '../../src/aidlc-planning/context/planning-context-builder.js';
import { ReviewService } from '../../src/review-implementation/services/review-service.js';
import { reviewRoutes } from '../../src/review-implementation/http/review-routes.js';
import { LocalAppBoundary } from '../../src/sr-document-foundation/http/boundary.js';
import { routes } from '../../src/sr-document-foundation/http/routes.js';
import { emptyChanges } from '../../src/sr-document-foundation/storage/store-port.js';
import { services } from '../sr-document-foundation/helpers/test-db.js';

async function reviewServer(dropRequest = false) {
  const t = services(); const execute = vi.fn(async () => ({ ok: false as const, error: { code: 'UNEXPECTED_CLI', message: 'Unexpected CLI' } }));
  const planning = new PlanningService(t.store, t.docs, new PlanningContextBuilder(t.store, resolve('.aidlc-rule-details')), { execute });
  const reviews = new ReviewService(t.store, t.docs); const app = express();
  if (dropRequest) app.use((req, res, next) => { const json = res.json.bind(res); res.json = body => { if (dropRequest && req.method === 'POST' && req.path.endsWith('/reviews') && body?.ok) { dropRequest = false; res.destroy(); return res; } return json(body); }; next(); });
  app.use('/api', routes(new LocalAppBoundary(t.sr, t.docs, t.store), planning, reviewRoutes(reviews, t.sr)));
  const server = createServer(app);
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { await planning.close(); t.close(); throw error; }
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected assigned local port');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, role?: string, operationId = randomUUID()) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId, ...(role ? { 'X-Planrepo-Role': role } : {}) }, body: JSON.stringify(body) });
  const sr = unwrap(t.sr.create({ title: 'HTTP review', description: '고정 대상' }, AUTHOR));
  const change = emptyChanges(); change.requireSrs.push(sr.id); change.planning = { expectedRevision: null, state: { ...initialWorkflow(sr.id), revision: 1, stageIndex: 1, column: 'inception' } }; unwrap(t.store.commit(change));
  const generated = unwrap(t.docs.prepareGenerated(sr.id, randomUUID(), [{ logicalKey: 'plan', title: '계획', body: '원래 본문' }])); unwrap(t.store.commit(generated));
  const target = generated.pointers[0]!;
  const ready = () => { const state = unwrap(t.store.read({ kind: 'workflow', srId: sr.id }))!; const c = emptyChanges(); c.requireSrs.push(sr.id); c.planning = { expectedRevision: state.revision, state: { ...state, revision: state.revision + 1, stageIndex: 8, column: 'implementation_ready', status: 'complete' } }; unwrap(t.store.commit(c)); return state.revision + 1; };
  const get = async (path: string) => { const response = await fetch(base + path); expect(response.status).toBe(200); return (await response.json()).data; };
  return { ...t, base, post, get, execute, sr, target, ready, stop: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await planning.close(); t.close(); } };
}

test('review HTTP validates roles, resolves the receipt and keeps result bound to the old version', async () => {
  const t = await reviewServer(); try {
    const path = `/api/srs/${t.sr.id}/reviews`; const draft = { target: t.target, comment: '검토 요청' };
    for (const role of [undefined, 'admin']) expect((await t.post(path, draft, role)).status).toBe(400);
    const denied = await t.post(path, draft, 'reviewer'); expect((await denied.json()).error.code).toBe('ROLE_REQUIRED');
    const op = randomUUID(); const request = await t.post(path, draft, 'author', op); expect(request.status).toBe(201); const review = (await request.json()).data;
    expect((await t.get(`/api/operations/${op}`))).toMatchObject({ status: 'committed', receipt: { kind: 'review_request', reviewId: review.id, srId: t.sr.id } });
    expect((await t.get('/api/board')).items.find((s: { id: string }) => s.id === t.sr.id).pendingReviews).toBe(1);
    const latest = unwrap(t.docs.edit(t.target, '새 버전', AUTHOR)).view;
    expect(await t.get(`${path}/${review.id}`)).toMatchObject({ target: t.target, isLatest: false, latestVersionRef: latest.latestVersionRef });
    const resultPath = `${path}/${review.id}/results`; const result = { kind: 'approve', comment: '원래 버전 확인 완료' };
    expect((await (await t.post(resultPath, result, 'author')).json()).error.code).toBe('ROLE_REQUIRED');
    const response = await t.post(resultPath, result, 'reviewer'); expect(response.status).toBe(200); expect((await response.json()).data).toMatchObject({ status: 'approved', target: t.target, isLatest: false });
    expect((await t.get('/api/board')).items.find((s: { id: string }) => s.id === t.sr.id).pendingReviews).toBe(0);
    expect((await t.post(resultPath, result, 'reviewer')).status).toBe(409); expect(t.execute).not.toHaveBeenCalled();
  } finally { await t.stop(); }
});

test('dropped review request response can be replayed with one review and one request event', async () => {
  const t = await reviewServer(true); try {
    const path = `/api/srs/${t.sr.id}/reviews`; const body = { target: t.target, comment: '응답 유실 검증' }; const op = randomUUID();
    await expect(t.post(path, body, 'author', op)).rejects.toThrow();
    const receipt = await t.get(`/api/operations/${op}`); expect(receipt.status).toBe('committed');
    const replay = await t.post(path, body, 'author', op); expect(replay.status).toBe(201); expect((await replay.json()).data.id).toBe(receipt.receipt.reviewId);
    expect((await t.get(path)).items).toHaveLength(1);
    expect((await t.get(`/api/srs/${t.sr.id}/history`)).items.filter((e: { kind: string }) => e.kind === 'review_requested')).toHaveLength(1);
    expect((await t.post(path, { ...body, comment: '내용 변경' }, 'author', op)).status).toBe(409); expect(t.execute).not.toHaveBeenCalled();
  } finally { await t.stop(); }
});

test('manual completion validates role/revision and persists a replayable declaration without invoking CLI', async () => {
  const t = await reviewServer(); try {
    const request = await t.post(`/api/srs/${t.sr.id}/reviews`, { target: t.target, comment: '대기 리뷰' }, 'author'); expect(request.status).toBe(201);
    const revision = t.ready(); const path = `/api/srs/${t.sr.id}/implementation`; const op = randomUUID();
    expect((await t.post(path, { revision })).status).toBe(400);
    expect((await (await t.post(path, { revision }, 'reviewer')).json()).error.code).toBe('ROLE_REQUIRED');
    expect((await t.post(path, { revision: revision - 1 }, 'author')).status).toBe(409);
    expect((await t.post(path, { revision: '2' }, 'author')).status).toBe(400);
    const completed = await t.post(path, { revision }, 'author', op); expect(completed.status).toBe(200); expect((await completed.json()).data.column).toBe('implemented');
    expect(await t.get(`/api/operations/${op}`)).toMatchObject({ status: 'committed', receipt: { kind: 'mark_implemented', srId: t.sr.id } });
    expect((await t.post(path, { revision }, 'author', op)).status).toBe(200);
    expect((await t.get(`/api/srs/${t.sr.id}/workflow`))).toMatchObject({ column: 'implemented', revision: revision + 1 });
    const history = await t.get(`/api/srs/${t.sr.id}/history`); const declarations = history.items.filter((e: { kind: string }) => e.kind === 'implementation_marked'); expect(declarations).toHaveLength(1);
    const event = await t.get(`/api/srs/${t.sr.id}/history/${declarations[0].id}`); expect(event.details).toMatchObject({ declaration: 'manual', buildVerified: false });
    expect((await t.get(`/api/srs/${t.sr.id}/reviews`)).items[0].status).toBe('requested'); expect(t.execute).not.toHaveBeenCalled();
  } finally { await t.stop(); }
});
