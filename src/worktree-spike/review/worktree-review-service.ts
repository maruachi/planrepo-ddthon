import { createHash, randomUUID } from 'node:crypto';
import type { ActorContext, CommandContext, Page, PageOptions, Result } from '../../shared/contracts.js';
import { errorOf, fail, unwrap } from '../../shared/errors.js';
import { id, text } from '../../shared/validation.js';
import type { StorePort } from '../../sr-document-foundation/storage/store-port.js';
import type { WorktreeSpikeService } from '../worktree-spike-service.js';
import type { WorktreeReviewView } from './worktree-review-contracts.js';
import type { SQLiteWorktreeReviewPersistence } from './sqlite-worktree-review-persistence.js';

const COMMENT_BYTES = 65536;
const fingerprint = (kind: CommandContext['kind'], values: unknown[]) => createHash('sha256').update(JSON.stringify([kind, ...values])).digest('hex');

export class WorktreeReviewService {
  constructor(private readonly store: StorePort, private readonly worktree: WorktreeSpikeService, private readonly persistence: SQLiteWorktreeReviewPersistence) {}

  list(srId: string, options?: PageOptions): Result<Page<WorktreeReviewView>> {
    try { id(srId); unwrap(this.store.read({ kind: 'sr', srId })); return { ok: true, data: this.persistence.list(srId, options) }; }
    catch (error) { return { ok: false, error: errorOf(error, 'STORAGE_FAILED') }; }
  }

  get(srId: string, reviewId: string): Result<WorktreeReviewView> {
    try { id(srId); id(reviewId); unwrap(this.store.read({ kind: 'sr', srId })); return { ok: true, data: this.persistence.get(srId, reviewId) }; }
    catch (error) { return { ok: false, error: errorOf(error, 'STORAGE_FAILED') }; }
  }

  async request(srId: string, pathInput: unknown, commentInput: unknown, actor: ActorContext, operationId: string): Promise<Result<WorktreeReviewView>> {
    try {
      id(srId); id(operationId, 'operationId'); this.role(actor, 'author');
      const path = text(pathInput, 'path', 4096, true, true);
      const comment = text(commentInput, 'comment', COMMENT_BYTES, true);
      const context: CommandContext & { srId: string } = { operationId, kind: 'worktree_review_request', fingerprint: fingerprint('worktree_review_request', [srId, path, comment, actor]), srId };
      const replay = this.persistence.replay(context); if (replay) return { ok: true, data: replay };
      this.requirePeerReview(srId);
      const document = await this.worktree.document(srId, path);
      const requestedAt = new Date().toISOString();
      const review: WorktreeReviewView = { id: randomUUID(), srId, path: document.path, hash: document.hash, body: document.body, requestComment: comment, requestedAt, status: 'requested' };
      return { ok: true, data: this.persistence.create(review, context, actor) };
    } catch (error) { return { ok: false, error: errorOf(error, 'STORAGE_FAILED') }; }
  }

  decide(srId: string, reviewId: string, kindInput: unknown, commentInput: unknown, actor: ActorContext, operationId: string): Result<WorktreeReviewView> {
    try {
      id(srId); id(reviewId); id(operationId, 'operationId'); this.role(actor, 'reviewer');
      if (kindInput !== 'approve' && kindInput !== 'request_changes') fail('VALIDATION_ERROR', '피어 리뷰 결과를 확인해 주세요.');
      const comment = text(commentInput, 'comment', COMMENT_BYTES, true);
      const context: CommandContext & { srId: string } = { operationId, kind: 'worktree_review_result', fingerprint: fingerprint('worktree_review_result', [srId, reviewId, kindInput, comment, actor]), srId };
      const replay = this.persistence.replay(context); if (replay) return { ok: true, data: replay };
      this.requirePeerReview(srId);
      const previous = this.persistence.get(srId, reviewId);
      if (previous.status !== 'requested') fail('REVIEW_CONFLICT', '이미 결과가 기록된 피어 리뷰입니다.');
      const review: WorktreeReviewView = { ...previous, status: kindInput === 'approve' ? 'approved' : 'changes_requested', resultComment: comment, decidedAt: new Date().toISOString() };
      return { ok: true, data: this.persistence.decide(review, context, actor) };
    } catch (error) { return { ok: false, error: errorOf(error, 'STORAGE_FAILED') }; }
  }

  private requirePeerReview(srId: string): void {
    const sr = unwrap(this.store.read({ kind: 'boardItem', srId }));
    if (sr.column !== 'peer_review') fail('REVIEW_ACTION_BLOCKED', '피어 리뷰 칸에서만 리뷰를 요청하거나 처리할 수 있습니다.');
  }

  private role(actor: ActorContext, expected: 'author' | 'reviewer'): void {
    if (actor.source !== 'user' || actor.role !== expected) fail('ROLE_REQUIRED', expected === 'author' ? '작성자 역할로 요청해 주세요.' : '리뷰어 역할로 결과를 기록해 주세요.');
  }
}
