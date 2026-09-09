import { Router, type Request } from 'express';
import { fail } from '../../shared/errors.js';
import { id, object, text } from '../../shared/validation.js';
import { sendResult } from '../../sr-document-foundation/http/error-handler.js';
import { WORKTREE_MESSAGE_BYTES } from '../contracts.js';
import type { WorktreeSpikeService } from '../worktree-spike-service.js';

export function worktreeSpikeRoutes(service: WorktreeSpikeService): Router {
  const router = Router();
  const srId = (request: Request) => id(request.params.srId, 'srId');
  const operationId = (request: Request) => id(request.get('X-Operation-Id'), 'operationId');
  router.get('/srs/:srId/worktree-spike', (request, response) => {
    sendResult(response, { ok: true, data: service.get(srId(request)) });
  });
  router.get('/srs/:srId/worktree-spike/document', async (request, response) => {
    object(request.query, ['path', 'versionId']);
    sendResult(response, { ok: true, data: await service.document(srId(request), text(request.query.path, 'path', 4096, true, true), request.query.versionId === undefined ? undefined : id(request.query.versionId, 'versionId')) });
  });
  router.get('/srs/:srId/worktree-spike/document/versions', (request, response) => {
    object(request.query, ['path']);
    sendResult(response, { ok: true, data: { items: service.versions(srId(request), text(request.query.path, 'path', 4096, true, true)), nextCursor: null } });
  });
  router.post('/srs/:srId/worktree-spike/document/edits', async (request, response) => {
    const body = object(request.body, ['path', 'expectedHash', 'body']);
    const expectedHash = text(body.expectedHash, 'expectedHash', 64, true, true);
    if (!/^[a-f0-9]{64}$/u.test(expectedHash)) fail('VALIDATION_ERROR', '올바른 문서 SHA-256이 필요합니다.', { field: 'expectedHash' });
    sendResult(response, { ok: true, data: await service.edit(srId(request), operationId(request), { path: text(body.path, 'path', 4096, true, true), expectedHash, body: text(body.body, 'body') }) });
  });
  router.post('/srs/:srId/worktree-spike/provision', async (request, response) => {
    object(request.body, []);
    sendResult(response, { ok: true, data: await service.provision(srId(request), operationId(request)) });
  });
  router.post('/srs/:srId/worktree-spike/resume', async (request, response) => {
    object(request.body, []);
    sendResult(response, { ok: true, data: await service.resume(srId(request), operationId(request)) }, 202);
  });
  router.post('/srs/:srId/worktree-spike/message', async (request, response) => {
    const body = object(request.body, ['message']);
    sendResult(response, { ok: true, data: await service.message(srId(request), operationId(request), text(body.message, 'message', WORKTREE_MESSAGE_BYTES, true)) });
  });
  router.post('/srs/:srId/worktree-spike/finish', async (request, response) => {
    object(request.body, []);
    sendResult(response, { ok: true, data: await service.finish(srId(request), operationId(request)) });
  });
  router.post('/srs/:srId/worktree-spike/cancel', async (request, response) => {
    object(request.body, []);
    sendResult(response, { ok: true, data: await service.cancel(srId(request), operationId(request)) });
  });
  return router;
}
