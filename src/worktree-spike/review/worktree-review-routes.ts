import { Router, type Request } from 'express';
import type { ActorContext } from '../../shared/contracts.js';
import { fail } from '../../shared/errors.js';
import { id, object } from '../../shared/validation.js';
import { sendResult } from '../../sr-document-foundation/http/error-handler.js';
import { pageOptions } from '../../sr-document-foundation/http/validation.js';
import type { WorktreeReviewService } from './worktree-review-service.js';

function actor(request: Request): ActorContext {
  const role = request.get('X-Planrepo-Role');
  if (role !== 'author' && role !== 'reviewer') fail('VALIDATION_ERROR', '작성자 또는 리뷰어 역할이 필요합니다.');
  return { source: 'user', role };
}

export function worktreeReviewRoutes(service: WorktreeReviewService): Router {
  const router = Router();
  router.get('/srs/:srId/worktree-reviews', (request, response) => sendResult(response, service.list(id(request.params.srId), pageOptions(request.query))));
  router.get('/srs/:srId/worktree-reviews/:reviewId', (request, response) => sendResult(response, service.get(id(request.params.srId), id(request.params.reviewId))));
  router.post('/srs/:srId/worktree-reviews', async (request, response) => {
    const body = object(request.body, ['path', 'comment']);
    sendResult(response, await service.request(id(request.params.srId), body.path, body.comment, actor(request), id(request.get('X-Operation-Id'))), 201);
  });
  router.post('/srs/:srId/worktree-reviews/:reviewId/results', (request, response) => {
    const body = object(request.body, ['kind', 'comment']);
    sendResult(response, service.decide(id(request.params.srId), id(request.params.reviewId), body.kind, body.comment, actor(request), id(request.get('X-Operation-Id'))));
  });
  return router;
}
