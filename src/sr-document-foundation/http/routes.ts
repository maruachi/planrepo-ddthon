import express, { Router, type Request } from 'express';
import { AUTHOR, type VersionRef } from '../../shared/contracts.js';
import { fail } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import { id, object, text } from '../../shared/validation.js';
import type { LocalAppBoundary } from './boundary.js';
import { errorHandler, sendResult } from './error-handler.js';
import { pageOptions, srDraft } from './validation.js';
import type { PlanningService } from '../../aidlc-planning/services/planning-service.js';
import { planningRoutes } from '../../aidlc-planning/http/planning-routes.js';
import type { Router as ExpressRouter } from 'express';
const param = (r: Request, name: string) => id(r.params[name], name);
const ref = (r: Request, version: unknown): VersionRef => ({ srId: param(r, 'srId'), documentId: param(r, 'documentId'), versionId: id(version, 'versionId') });
export function routes(boundary: LocalAppBoundary, planning?: PlanningService, review?: ExpressRouter): Router {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const host = `127.0.0.1:${req.socket.localPort}`;
    if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress ?? '') || req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return fail('VALIDATION_ERROR', '로컬 앱 주소에서 요청해 주세요.');
    if (req.method === 'POST') {
      if (!req.is('application/json') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) return sendResult(res, { ok: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '압축하지 않은 application/json 요청이 필요합니다.' } });
      id(req.get('X-Operation-Id'), 'operationId');
    }
    next();
  });
  router.use(express.json({ limit: LIMITS.json, inflate: false, strict: true }));
  router.get('/config', async (_req, res) => sendResult(res, await boundary.query({ kind: 'config' })));
  router.get('/board', async (req, res) => sendResult(res, await boundary.query({ kind: 'board', options: pageOptions(req.query) })));
  router.post('/srs', async (req, res) => sendResult(res, await boundary.command({ kind: 'create', input: srDraft(req.body) }, AUTHOR, id(req.get('X-Operation-Id'))), 201));
  router.get('/operations/:operationId', async (req, res) => sendResult(res, await boundary.query({ kind: 'operation', operationId: param(req, 'operationId') })));
  router.get('/srs/:srId', async (req, res) => sendResult(res, await boundary.query({ kind: 'sr', srId: param(req, 'srId') })));
  router.get('/srs/:srId/documents', async (req, res) => sendResult(res, await boundary.query({ kind: 'documents', srId: param(req, 'srId'), options: pageOptions(req.query) })));
  router.get('/srs/:srId/documents/:documentId/versions', async (req, res) => sendResult(res, await boundary.query({ kind: 'versions', srId: param(req, 'srId'), documentId: param(req, 'documentId'), options: pageOptions(req.query) })));
  router.get('/srs/:srId/documents/:documentId/versions/:versionId', async (req, res) => sendResult(res, await boundary.query({ kind: 'version', target: ref(req, req.params.versionId) })));
  router.get('/srs/:srId/history', async (req, res) => sendResult(res, await boundary.query({ kind: 'history', srId: param(req, 'srId'), documentId: req.query.documentId === undefined ? undefined : id(req.query.documentId, 'documentId'), options: pageOptions(req.query, ['documentId']) })));
  router.get('/srs/:srId/history/:eventId', async (req, res) => sendResult(res, await boundary.query({ kind: 'event', srId: param(req, 'srId'), eventId: param(req, 'eventId') })));
  router.post('/srs/:srId/documents/:documentId/edits', async (req, res) => { const b = object(req.body, ['versionId', 'body']); sendResult(res, await boundary.command({ kind: 'edit', target: ref(req, b.versionId), body: text(b.body, 'body') }, AUTHOR, id(req.get('X-Operation-Id')))); });
  router.post('/srs/:srId/documents/:documentId/restorations', async (req, res) => { const b = object(req.body, ['versionId']); sendResult(res, await boundary.command({ kind: 'restore', source: ref(req, b.versionId) }, AUTHOR, id(req.get('X-Operation-Id')))); });
  router.get('/srs/:srId/documents/:documentId/compare', async (req, res) => {
    object(req.query, ['left', 'right']); const cancel = new AbortController(); const onClose = () => { if (!res.writableEnded) cancel.abort(); }; res.on('close', onClose);
    try { sendResult(res, await boundary.query({ kind: 'compare', left: ref(req, req.query.left), right: ref(req, req.query.right), signal: cancel.signal })); } finally { res.off('close', onClose); }
  });
  if (planning) router.use(planningRoutes(planning));
  if (review) router.use(review);
  router.use((_req, res) => sendResult(res, { ok: false, error: { code: 'NOT_FOUND', message: 'API 경로를 찾을 수 없습니다.' } }));
  router.use(errorHandler); return router;
}
