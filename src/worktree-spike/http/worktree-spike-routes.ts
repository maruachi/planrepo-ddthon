import { Router, type Request } from 'express';
import { id, object } from '../../shared/validation.js';
import { sendResult } from '../../sr-document-foundation/http/error-handler.js';
import type { WorktreeSpikeService } from '../worktree-spike-service.js';

export function worktreeSpikeRoutes(service: WorktreeSpikeService): Router {
  const router = Router();
  const srId = (request: Request) => id(request.params.srId, 'srId');
  const operationId = (request: Request) => id(request.get('X-Operation-Id'), 'operationId');
  router.get('/srs/:srId/worktree-spike', (request, response) => {
    sendResult(response, { ok: true, data: service.get(srId(request)) });
  });
  router.post('/srs/:srId/worktree-spike/provision', async (request, response) => {
    object(request.body, []);
    sendResult(response, { ok: true, data: await service.provision(srId(request), operationId(request)) });
  });
  router.post('/srs/:srId/worktree-spike/resume', async (request, response) => {
    object(request.body, []);
    sendResult(response, { ok: true, data: await service.resume(srId(request), operationId(request)) }, 202);
  });
  return router;
}
