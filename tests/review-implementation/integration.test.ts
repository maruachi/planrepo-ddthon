import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AUTHOR, type ActorContext, type Result } from '../../src/shared/contracts.js';
import { unwrap } from '../../src/shared/errors.js';
import { PLANNING_STAGES, type ContextSnapshot, type PlanRunnerPort, type RunnerOutcome } from '../../src/shared/planning-contracts.js';
import { PlanningService } from '../../src/aidlc-planning/services/planning-service.js';
import { PlanningContextBuilder } from '../../src/aidlc-planning/context/planning-context-builder.js';
import { ReviewService } from '../../src/review-implementation/services/review-service.js';
import { services } from '../sr-document-foundation/helpers/test-db.js';

const REVIEWER: ActorContext = { source: 'user', role: 'reviewer' };
function setup() {
  const t = services(); const contexts: ContextSnapshot[] = [];
  const runner: PlanRunnerPort = { async execute(context): Promise<Result<RunnerOutcome>> {
    contexts.push(context);
    return { ok: true, data: { artifacts: [{ logicalKey: context.stage, title: context.stage, body: `검토용 ${context.stage} 문서` }], questions: [], summary: '생성 완료' } };
  } };
  const planning = new PlanningService(t.store, t.docs, new PlanningContextBuilder(t.store, resolve('.aidlc-rule-details')), runner);
  const reviews = new ReviewService(t.store, t.docs);
  const sr = unwrap(t.sr.create({ title: '리뷰와 구현 완료', description: '계획과 독립적인 피어 리뷰' }, AUTHOR));
  const view = () => unwrap(planning.getWorkflow(sr.id));
  const approve = () => { const v = view(); return unwrap(planning.decide(sr.id, { kind: 'approve', comment: '', targets: v.reviewTargets, revision: v.revision }, AUTHOR)); };
  const generate = async (action: 'generate' | 'next' = 'generate') => { const run = unwrap(planning.advance(sr.id, action, AUTHOR, view().revision)); await planning.waitForIdle(); expect(unwrap(planning.getRun(sr.id, run.id)).status).toBe('succeeded'); };
  const enterInception = async () => { await generate(); approve(); await generate('next'); };
  return { ...t, srService: t.sr, contexts, planning, reviews, sr, view, approve, generate, enterInception };
}

it('keeps peer review approvals independent from own approval and pending reviews do not block next', async () => {
  const t = setup();
  try {
    await t.enterInception(); const before = t.view(); const target = before.reviewTargets[0]!;
    const review = unwrap(t.reviews.request(t.sr.id, { target, comment: '사용자 스토리 검토 요청\r\n' }, AUTHOR));
    expect(t.view()).toEqual(before);
    expect(review).toMatchObject({ target, status: 'requested', isLatest: true });
    expect(t.reviews.submitResult(t.sr.id, review.id, { kind: 'approve', comment: '역할 확인' }, AUTHOR)).toMatchObject({ ok: false, error: { code: 'ROLE_REQUIRED' } });
    const result = unwrap(t.reviews.submitResult(t.sr.id, review.id, { kind: 'approve', comment: '대상 버전 검토 완료' }, REVIEWER));
    expect(result).toMatchObject({ target, status: 'approved' });
    expect(t.view()).toEqual(before);
    expect(t.planning.advance(t.sr.id, 'next', AUTHOR, before.revision)).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
    const pending = unwrap(t.reviews.request(t.sr.id, { target, comment: '추가 검토 요청' }, AUTHOR));
    t.approve(); await t.generate('next');
    expect(t.view().stageIndex).toBe(2);
    expect(unwrap(t.reviews.getReview(t.sr.id, pending.id)).status).toBe('requested');
    const context = t.contexts.at(-1)!;
    expect(context.history.find(e => e.kind === 'review_approved')?.details).toMatchObject({ reviewId: review.id, target, comment: '대상 버전 검토 완료' });
    expect(context.history.filter(e => e.kind === 'review_requested')).toHaveLength(2);
    expect(context.documents.find(d => d.documentId === target.documentId)?.body).toBe('검토용 user-stories 문서');
  } finally { t.close(); }
});

it('records a late result against its original version after editing and stage progression', async () => {
  const t = setup();
  try {
    await t.enterInception(); const target = t.view().reviewTargets[0]!;
    const review = unwrap(t.reviews.request(t.sr.id, { target, comment: '원래 버전을 검토해 주세요.' }, AUTHOR));
    t.approve(); await t.generate('next');
    const edit = unwrap(t.docs.edit(target, '리뷰 요청 후 바뀐 본문\r\n', AUTHOR));
    const before = t.view();
    const result = unwrap(t.reviews.submitResult(t.sr.id, review.id, { kind: 'request_changes', comment: '이전 버전의 시나리오를 보완해 주세요.' }, REVIEWER));
    expect(result).toMatchObject({ target, isLatest: false, latestVersionRef: edit.view.latestVersionRef, versionNumber: 1, status: 'changes_requested' });
    expect(t.view()).toEqual(before);
    expect(unwrap(t.docs.readVersion(result.target)).body).toBe('검토용 user-stories 문서');
    expect(unwrap(t.docs.readVersion(result.latestVersionRef)).body).toBe('리뷰 요청 후 바뀐 본문\r\n');
    expect(t.reviews.submitResult(t.sr.id, review.id, { kind: 'approve', comment: '결과 덮어쓰기 시도' }, REVIEWER)).toMatchObject({ ok: false, error: { code: 'REVIEW_CONFLICT' } });
    const event = unwrap(t.docs.listHistory(t.sr.id)).items.find(e => e.kind === 'review_changes_requested')!;
    expect(event.versionRefs).toEqual([target]);
  } finally { t.close(); }
});

it('marks implementation manually without another CLI run and rejects stale revision or reviewer role', async () => {
  const t = setup();
  try {
    let pendingId = '';
    for (let i = 0; i < PLANNING_STAGES.length; i++) {
      await t.generate(i === 0 ? 'generate' : 'next');
      if (i === 1) pendingId = unwrap(t.reviews.request(t.sr.id, { target: t.view().reviewTargets[0]!, comment: '완료를 막지 않는 추가 검토' }, AUTHOR)).id;
      t.approve();
    }
    const ready = unwrap(t.planning.completePlanning(t.sr.id, AUTHOR, t.view().revision));
    const calls = t.contexts.length;
    expect(t.planning.advance(t.sr.id, 'generate', AUTHOR, ready.revision).ok).toBe(false);
    expect(t.srService.markImplemented(t.sr.id, REVIEWER, ready.revision)).toMatchObject({ ok: false, error: { code: 'ROLE_REQUIRED' } });
    expect(t.srService.markImplemented(t.sr.id, AUTHOR, ready.revision - 1)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_CONFLICT' } });
    expect(t.view()).toEqual(ready);
    const command = { operationId: randomUUID(), kind: 'mark_implemented' as const, fingerprint: 'manual-complete' };
    expect(unwrap(t.srService.markImplemented(t.sr.id, AUTHOR, ready.revision, command)).column).toBe('implemented');
    expect(t.view()).toMatchObject({ column: 'implemented', status: 'complete', revision: ready.revision + 1 });
    expect(unwrap(t.reviews.getReview(t.sr.id, pendingId)).status).toBe('requested');
    expect(t.contexts).toHaveLength(calls);
    expect(unwrap(t.srService.markImplemented(t.sr.id, AUTHOR, ready.revision, command)).column).toBe('implemented');
    expect(unwrap(t.docs.listHistory(t.sr.id)).items.filter(e => e.kind === 'implementation_marked')).toHaveLength(1);
  } finally { t.close(); }
});
