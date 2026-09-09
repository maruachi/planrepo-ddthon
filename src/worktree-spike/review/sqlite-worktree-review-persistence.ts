import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ActorContext, CommandContext, Page, PageOptions } from '../../shared/contracts.js';
import { fail } from '../../shared/errors.js';
import { cursorKey, page, paging } from '../../sr-document-foundation/storage/cursors.js';
import type { WorktreeReviewView } from './worktree-review-contracts.js';

type Receipt = { kind: string; fingerprint: string; srId: string; reviewId: string };
type WorktreeReviewCommand = CommandContext & { srId: string };

function parsed(payload: string): WorktreeReviewView {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid persisted worktree review');
  return value as WorktreeReviewView;
}

export class SQLiteWorktreeReviewPersistence {
  constructor(private readonly db: Database.Database) {}

  get(srId: string, reviewId: string): WorktreeReviewView {
    const row = this.db.prepare('SELECT sr_id,payload FROM worktree_reviews WHERE id=?').get(reviewId) as { sr_id: string; payload: string } | undefined;
    if (!row) fail('NOT_FOUND', '피어 리뷰를 찾을 수 없습니다.');
    if (row.sr_id !== srId) fail('REFERENCE_MISMATCH', '다른 SR의 피어 리뷰입니다.');
    return parsed(row.payload);
  }

  list(srId: string, options?: PageOptions): Page<WorktreeReviewView> {
    const scope = JSON.stringify(['worktree-reviews', srId]);
    const { limit, key } = paging(scope, options);
    cursorKey(key, ['string', 'string']);
    const rows = this.db.prepare(`SELECT payload FROM worktree_reviews WHERE sr_id=? ${key ? 'AND (requested_at,id)<(?,?)' : ''} ORDER BY requested_at DESC,id DESC LIMIT ?`)
      .all(srId, ...(key ?? []), limit + 1) as { payload: string }[];
    return page(rows.map(row => parsed(row.payload)), limit, scope, review => [review.requestedAt, review.id]);
  }

  replay(context: WorktreeReviewCommand): WorktreeReviewView | undefined {
    const row = this.db.prepare(`SELECT c.command_kind AS kind,c.fingerprint,c.sr_id AS srId,r.review_id AS reviewId
      FROM command_receipts c JOIN worktree_review_receipts r ON r.operation_id=c.operation_id WHERE c.operation_id=?`)
      .get(context.operationId) as Receipt | undefined;
    if (!row) return undefined;
    if (row.kind !== context.kind || row.fingerprint !== context.fingerprint || row.srId !== context.srId) fail('OPERATION_CONFLICT', '같은 작업 ID가 다른 피어 리뷰 요청에 사용되었습니다.');
    return this.get(row.srId, row.reviewId);
  }

  create(view: WorktreeReviewView, context: WorktreeReviewCommand, actor: ActorContext): WorktreeReviewView {
    return this.db.transaction(() => {
      const replay = this.replay(context);
      if (replay) return replay;
      this.db.prepare('INSERT INTO worktree_reviews (id,sr_id,document_path,document_hash,requested_at,status,payload) VALUES (?,?,?,?,?,?,?)')
        .run(view.id, view.srId, view.path, view.hash, view.requestedAt, view.status, JSON.stringify(view));
      this.receipt(context, view.id, view.requestedAt);
      this.event(view.srId, 'worktree_review_requested', actor, view.requestedAt, 'AI-DLC 문서의 피어 리뷰를 요청했습니다.', { reviewId: view.id, path: view.path, hash: view.hash, comment: view.requestComment });
      return view;
    }).immediate();
  }

  decide(view: WorktreeReviewView, context: WorktreeReviewCommand, actor: ActorContext): WorktreeReviewView {
    return this.db.transaction(() => {
      const replay = this.replay(context);
      if (replay) return replay;
      const changed = this.db.prepare("UPDATE worktree_reviews SET status=?,payload=? WHERE sr_id=? AND id=? AND status='requested'")
        .run(view.status, JSON.stringify(view), view.srId, view.id).changes;
      if (changed !== 1) fail('REVIEW_CONFLICT', '이미 결과가 기록된 피어 리뷰입니다.');
      this.receipt(context, view.id, view.decidedAt!);
      this.event(view.srId, view.status === 'approved' ? 'worktree_review_approved' : 'worktree_review_changes_requested', actor, view.decidedAt!, view.status === 'approved' ? 'AI-DLC 문서의 피어 리뷰를 승인했습니다.' : 'AI-DLC 문서의 수정을 요청했습니다.', { reviewId: view.id, path: view.path, hash: view.hash, comment: view.resultComment });
      return view;
    }).immediate();
  }

  private receipt(context: WorktreeReviewCommand, reviewId: string, committedAt: string): void {
    this.db.prepare('INSERT INTO command_receipts (operation_id,command_kind,fingerprint,sr_id,document_id,version_id,changed,committed_at) VALUES (?,?,?,?,NULL,NULL,1,?)')
      .run(context.operationId, context.kind, context.fingerprint, context.srId, committedAt);
    this.db.prepare('INSERT INTO worktree_review_receipts VALUES (?,?,?)').run(context.operationId, context.srId, reviewId);
  }

  private event(srId: string, kind: string, actor: ActorContext, occurredAt: string, summary: string, details: unknown): void {
    const sequence = Number((this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM history_events WHERE sr_id=?').get(srId) as { n: number }).n);
    this.db.prepare('INSERT INTO history_events VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), srId, sequence, kind, actor.source, actor.role ?? null, occurredAt, summary, null, JSON.stringify(details));
  }
}
