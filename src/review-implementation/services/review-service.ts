import { randomUUID } from 'node:crypto';
import type { ActorContext, CommandContext, Page, PageOptions, Result } from '../../shared/contracts.js';
import type { DemoRole, ReviewDraft, ReviewRecord, ReviewResultInput, ReviewView } from '../../shared/review-contracts.js';
import { fail, result, unwrap } from '../../shared/errors.js';
import { id, object, text } from '../../shared/validation.js';
import type { DocumentService } from '../../sr-document-foundation/services/document-service.js';
import { emptyChanges, type ChangeSet, type StorePort } from '../../sr-document-foundation/storage/store-port.js';

const COMMENT_BYTES = 65536;
export class ReviewService {
  constructor(private readonly store: StorePort, private readonly docs: DocumentService) {}

  private role(actor: ActorContext, expected: DemoRole): void {
    if (actor.source !== 'user' || actor.role !== expected) fail('ROLE_REQUIRED', expected === 'author' ? '작성자 역할로 요청해 주세요.' : '리뷰어 역할로 결과를 기록해 주세요.');
  }
  private view(review: ReviewRecord): ReviewView {
    const original = unwrap(this.docs.readVersion(review.target));
    const latest = original.isLatest ? original : unwrap(this.docs.readVersion(original.latestVersionRef));
    return { ...review, isLatest: original.isLatest, latestVersionRef: original.latestVersionRef, documentTitle: latest.title, versionNumber: original.versionNumber };
  }
  private replay(srId: string, kind: 'review_request' | 'review_result', command?: CommandContext): ReviewView | undefined {
    if (!command) return;
    id(command.operationId, 'operationId');
    if (command.kind !== kind) fail('OPERATION_CONFLICT', '요청 종류와 작업 식별자가 일치하지 않습니다.');
    const old = unwrap(this.store.read({ kind: 'receipt', operationId: command.operationId }));
    if (!old) return;
    if (old.kind !== kind || old.fingerprint !== command.fingerprint || old.srId !== srId || !old.reviewId) fail('OPERATION_CONFLICT', '같은 요청 식별자에 다른 내용이 있습니다.');
    return unwrap(this.getReview(srId, old.reviewId));
  }
  private save(c: ChangeSet, command?: CommandContext): ReviewView {
    c.command = command;
    const receipt = unwrap(this.store.commit(c));
    return unwrap(this.getReview(c.review!.review.srId, receipt?.reviewId ?? c.review!.review.id));
  }
  listReviews(srId: string, options?: PageOptions): Result<Page<ReviewView>> { return result(() => {
    id(srId, 'srId'); const page = unwrap(this.store.read({ kind: 'reviews', srId, options }));
    return { ...page, items: page.items.map(review => this.view(review)) };
  }); }
  getReview(srId: string, reviewId: string): Result<ReviewView> { return result(() => {
    id(srId, 'srId'); id(reviewId, 'reviewId'); return this.view(unwrap(this.store.read({ kind: 'review', srId, reviewId })));
  }); }

  request(srId: string, input: ReviewDraft, actor: ActorContext, command?: CommandContext): Result<ReviewView> { return result(() => {
    id(srId, 'srId'); this.role(actor, 'author');
    const replay = this.replay(srId, 'review_request', command); if (replay) return replay;
    const sr = unwrap(this.store.read({ kind: 'sr', srId }));
    if (sr.column !== 'inception' && sr.column !== 'construction') fail('REVIEW_ACTION_BLOCKED', 'Inception 또는 Construction에서 리뷰를 요청할 수 있습니다.');
    const ref = object(input.target, ['srId', 'documentId', 'versionId']);
    const target = { srId: id(ref.srId, 'srId'), documentId: id(ref.documentId, 'documentId'), versionId: id(ref.versionId, 'versionId') };
    if (target.srId !== srId) fail('REFERENCE_MISMATCH', '해당 SR의 문서 버전을 선택해 주세요.');
    unwrap(this.docs.readVersion(target));
    const comment = text(input.comment, 'comment', COMMENT_BYTES, true);
    const review: ReviewRecord = { id: randomUUID(), srId, target, requestComment: comment, requestedAt: new Date().toISOString(), status: 'requested' };
    const c = emptyChanges(); c.requireSrs.push(srId); c.review = { expectedStatus: null, review };
    c.events.push({ id: randomUUID(), srId, kind: 'review_requested', actor, occurredAt: review.requestedAt, summary: '문서 버전의 리뷰를 요청했습니다.', versionRefs: [target], details: { reviewId: review.id, target, comment } });
    c.outcome = { kind: 'review_request', srId, changed: true, reviewId: review.id };
    return this.save(c, command);
  }, 'STORAGE_FAILED'); }

  submitResult(srId: string, reviewId: string, input: ReviewResultInput, actor: ActorContext, command?: CommandContext): Result<ReviewView> { return result(() => {
    id(srId, 'srId'); id(reviewId, 'reviewId'); this.role(actor, 'reviewer');
    const replay = this.replay(srId, 'review_result', command);
    if (replay) { if (replay.id !== reviewId) fail('OPERATION_CONFLICT', '다른 리뷰에 사용한 요청 식별자입니다.'); return replay; }
    const previous = unwrap(this.store.read({ kind: 'review', srId, reviewId }));
    if (previous.status !== 'requested') fail('REVIEW_CONFLICT', '이미 결과가 기록된 리뷰입니다. 새 리뷰를 요청해 주세요.');
    if (input.kind !== 'approve' && input.kind !== 'request_changes') fail('VALIDATION_ERROR', '리뷰 결과 종류를 확인해 주세요.');
    const comment = text(input.comment, 'comment', COMMENT_BYTES, true);
    const review: ReviewRecord = { ...previous, status: input.kind === 'approve' ? 'approved' : 'changes_requested', resultComment: comment, decidedAt: new Date().toISOString() };
    const c = emptyChanges(); c.requireSrs.push(srId); c.review = { expectedStatus: 'requested', review };
    c.events.push({ id: randomUUID(), srId, kind: input.kind === 'approve' ? 'review_approved' : 'review_changes_requested', actor, occurredAt: review.decidedAt!, summary: input.kind === 'approve' ? '리뷰 대상 버전을 승인했습니다.' : '리뷰 대상 버전의 수정을 요청했습니다.', versionRefs: [review.target], details: { reviewId, target: review.target, kind: input.kind, comment } });
    c.outcome = { kind: 'review_result', srId, changed: true, reviewId };
    return this.save(c, command);
  }, 'STORAGE_FAILED'); }
}
