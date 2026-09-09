import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import type { ActorContext, CommandContext } from '../../shared/contracts.js';
import type { ReviewResultInput } from '../../shared/review-contracts.js';
import { fail } from '../../shared/errors.js';
import { id, object, text } from '../../shared/validation.js';
import { sendResult } from '../../sr-document-foundation/http/error-handler.js';
import { pageOptions } from '../../sr-document-foundation/http/validation.js';
import type { SRService } from '../../sr-document-foundation/services/sr-service.js';
import type { ReviewService } from '../services/review-service.js';
function actor(req: Request): ActorContext {
  const role = req.get('X-Planrepo-Role'); if (role !== 'author' && role !== 'reviewer') fail('VALIDATION_ERROR', '작성자 또는 리뷰어 역할이 필요합니다.');
  return { source: 'user', role };
}
function context(req: Request, kind: CommandContext['kind'], srId: string, body: unknown, who: ActorContext): CommandContext {
  return { operationId: id(req.get('X-Operation-Id')), kind, fingerprint: createHash('sha256').update(JSON.stringify([kind, srId, body, who])).digest('hex') };
}
export function reviewRoutes(reviews: ReviewService, srs: SRService): Router {
  const router = Router();
  router.get('/srs/:srId/reviews', (req, res) => sendResult(res, reviews.listReviews(id(req.params.srId), pageOptions(req.query))));
  router.get('/srs/:srId/reviews/:reviewId', (req, res) => sendResult(res, reviews.getReview(id(req.params.srId), id(req.params.reviewId))));
  router.post('/srs/:srId/reviews', (req, res) => {
    const srId = id(req.params.srId); const who = actor(req); const b = object(req.body, ['target', 'comment']); const t = object(b.target, ['srId', 'documentId', 'versionId']);
    const input = { target: { srId: id(t.srId), documentId: id(t.documentId), versionId: id(t.versionId) }, comment: text(b.comment, 'comment', 65536, true) };
    sendResult(res, reviews.request(srId, input, who, context(req, 'review_request', srId, input, who)), 201);
  });
  router.post('/srs/:srId/reviews/:reviewId/results', (req, res) => {
    const srId = id(req.params.srId); const reviewId = id(req.params.reviewId); const who = actor(req); const b = object(req.body, ['kind', 'comment']);
    if (b.kind !== 'approve' && b.kind !== 'request_changes') fail('VALIDATION_ERROR', '리뷰 결과 종류를 확인해 주세요.');
    const input: ReviewResultInput = { kind: b.kind, comment: text(b.comment, 'comment', 65536, true) };
    sendResult(res, reviews.submitResult(srId, reviewId, input, who, context(req, 'review_result', srId, { reviewId, ...input }, who)));
  });
  router.post('/srs/:srId/implementation', (req, res) => {
    const srId = id(req.params.srId); const who = actor(req); const b = object(req.body, ['revision']);
    if (!Number.isSafeInteger(b.revision) || Number(b.revision) < 0) fail('VALIDATION_ERROR', '계획 리비전이 필요합니다.');
    const input = { revision: Number(b.revision) };
    sendResult(res, srs.markImplemented(srId, who, input.revision, context(req, 'mark_implemented', srId, input, who)));
  });
  return router;
}
