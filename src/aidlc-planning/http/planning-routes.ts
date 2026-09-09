import { Router, type Request } from 'express';
import { AUTHOR, type VersionRef } from '../../shared/contracts.js';
import { fail } from '../../shared/errors.js';
import { id, object, text } from '../../shared/validation.js';
import { PLANNING_LIMITS, type PlanningAction } from '../../shared/planning-contracts.js';
import { sendResult } from '../../sr-document-foundation/http/error-handler.js';
import type { PlanningService } from '../services/planning-service.js';

function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) fail('VALIDATION_ERROR', '올바른 계획 리비전이 필요합니다.'); return Number(value); }
function targets(value: unknown): VersionRef[] {
  if (!Array.isArray(value) || value.length > PLANNING_LIMITS.documents) fail('VALIDATION_ERROR', '검토할 문서 버전 목록이 필요합니다.');
  return value.map(x => { const r = object(x, ['srId', 'documentId', 'versionId']); return { srId: id(r.srId), documentId: id(r.documentId), versionId: id(r.versionId) }; });
}
export function planningRoutes(service: PlanningService): Router {
  const router = Router(); const srId = (r: Request) => id(r.params.srId, 'srId'); const operation = (r: Request) => id(r.get('X-Operation-Id'), 'operationId');
  router.get('/srs/:srId/workflow', (req, res) => sendResult(res, service.getWorkflow(srId(req))));
  router.get('/srs/:srId/runs/:runId', (req, res) => sendResult(res, service.getRun(srId(req), id(req.params.runId))));
  router.post('/srs/:srId/planning/advance', (req, res) => {
    const b = object(req.body, ['action', 'revision']);
    if (!['generate', 'revise', 'next'].includes(String(b.action))) fail('VALIDATION_ERROR', '지원하지 않는 계획 행동입니다.');
    sendResult(res, service.command({ kind: 'planning_advance', srId: srId(req), action: b.action as PlanningAction, revision: revision(b.revision) }, AUTHOR, operation(req)), 202);
  });
  router.post('/srs/:srId/planning/answers', (req, res) => {
    const b = object(req.body, ['questionSetId', 'answers', 'revision']);
    if (!b.answers || typeof b.answers !== 'object' || Array.isArray(b.answers) || Object.keys(b.answers).length > PLANNING_LIMITS.questions) fail('VALIDATION_ERROR', '질문별 응답이 필요합니다.');
    const answers = Object.fromEntries(Object.entries(b.answers).map(([key, value]) => [key, text(value, key, PLANNING_LIMITS.answerBytes, true)]));
    sendResult(res, service.command({ kind: 'planning_answer', srId: srId(req), questionSetId: id(b.questionSetId), answers, revision: revision(b.revision) }, AUTHOR, operation(req)));
  });
  router.post('/srs/:srId/planning/decisions', (req, res) => {
    const b = object(req.body, ['kind', 'comment', 'targets', 'revision']);
    if (b.kind !== 'approve' && b.kind !== 'request_changes') fail('VALIDATION_ERROR', '결정 종류가 올바르지 않습니다.');
    sendResult(res, service.command({ kind: 'planning_decide', srId: srId(req), decision: { kind: b.kind, comment: text(b.comment, 'comment', PLANNING_LIMITS.answerBytes, b.kind === 'request_changes'), targets: targets(b.targets), revision: revision(b.revision) } }, AUTHOR, operation(req)));
  });
  router.post('/srs/:srId/planning/complete', (req, res) => {
    const b = object(req.body, ['revision']);
    sendResult(res, service.command({ kind: 'planning_complete', srId: srId(req), revision: revision(b.revision) }, AUTHOR, operation(req)));
  });
  return router;
}
