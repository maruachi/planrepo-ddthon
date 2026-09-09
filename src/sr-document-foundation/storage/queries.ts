import type Database from 'better-sqlite3';
import type { ActorContext, CommandReceipt, DocumentRecord, DocumentSummary, DocumentView, HistoryEvent, SR, SRSummary, VersionRef, VersionSummary } from '../../shared/contracts.js';
import { fail } from '../../shared/errors.js';
import { cursorKey, page, paging } from './cursors.js';
import type { ReadQuery, ReadResults } from './store-port.js';
import type { PlanningRun, WorkflowState } from '../../shared/planning-contracts.js';
import type { ReviewRecord } from '../../shared/review-contracts.js';
type Row = Record<string, string | number | null>;
const actor = (r: Row): ActorContext => ({ source: r.actor_source as ActorContext['source'], ...(r.actor_role ? { role: r.actor_role as ActorContext['role'] } : {}) });
const ref = (r: Row): VersionRef => ({ srId: String(r.sr_id), documentId: String(r.document_id), versionId: String(r.id) });
const document = (r: Row): DocumentRecord => ({ id: String(r.id), srId: String(r.sr_id), logicalKey: String(r.logical_key), latestVersionId: String(r.latest_version_id), createdAt: String(r.created_at) });
const summary = (r: Row): VersionSummary => ({ ...ref(r), versionNumber: Number(r.version_number), title: String(r.title), origin: r.origin as VersionSummary['origin'], createdAt: String(r.created_at), actor: actor(r), isLatest: r.id === r.latest_version_id, ...(r.base_version_id ? { baseVersionId: String(r.base_version_id) } : {}), ...(r.source_version_id ? { sourceVersionId: String(r.source_version_id) } : {}), ...(r.run_id ? { runId: String(r.run_id) } : {}) });
const versionColumns = 'v.id,v.sr_id,v.document_id,v.version_number,v.title,v.origin,v.created_at,v.actor_source,v.actor_role,v.base_version_id,v.source_version_id,v.run_id,d.latest_version_id';
export class Queries {
  constructor(readonly db: Database.Database) {}
  one(sql: string, ...params: (string | number)[]): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  all(sql: string, ...params: (string | number)[]): Row[] { return this.db.prepare(sql).all(...params) as Row[]; }
  sr(srId: string): SR {
    const r = this.one('SELECT * FROM srs WHERE id=?', srId); if (!r) fail('NOT_FOUND', 'SR을 찾을 수 없습니다.', { target: srId });
    return { id: srId, title: String(r.title), description: String(r.description), createdAt: String(r.created_at), actor: actor(r), column: r.workflow_column as SR['column'], ...(r.attachment_markdown !== null ? { attachmentMarkdown: String(r.attachment_markdown) } : {}), ...(r.attachment_display_name !== null ? { attachmentDisplayName: String(r.attachment_display_name) } : {}) };
  }
  document(srId: string, documentId: string): DocumentRecord {
    this.sr(srId); const r = this.one('SELECT * FROM documents WHERE id=?', documentId);
    if (!r) fail('NOT_FOUND', '문서를 찾을 수 없습니다.', { target: documentId });
    if (r.sr_id !== srId) fail('REFERENCE_MISMATCH', '다른 SR의 문서입니다.'); return document(r);
  }
  version(target: VersionRef): DocumentView {
    const d = this.document(target.srId, target.documentId);
    const r = this.one(`SELECT ${versionColumns},v.body FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=?`, target.versionId);
    if (!r) fail('NOT_FOUND', '버전을 찾을 수 없습니다.', { target: target.versionId });
    if (r.sr_id !== target.srId || r.document_id !== target.documentId) fail('REFERENCE_MISMATCH', '다른 문서의 버전입니다.');
    return { ...summary(r), body: String(r.body), latestVersionRef: { srId: d.srId, documentId: d.id, versionId: d.latestVersionId } };
  }
  event(r: Row, detail = false): HistoryEvent {
    const refs = this.all('SELECT sr_id,document_id,version_id FROM event_version_refs WHERE sr_id=? AND event_id=? ORDER BY document_id,version_id', String(r.sr_id), String(r.id));
    return { id: String(r.id), srId: String(r.sr_id), sequence: Number(r.sequence), kind: String(r.kind), actor: actor(r), occurredAt: String(r.occurred_at), summary: String(r.summary), versionRefs: refs.map(x => ({ srId: String(x.sr_id), documentId: String(x.document_id), versionId: String(x.version_id) })), ...(detail && r.subject_json !== null ? { subject: JSON.parse(String(r.subject_json)) as unknown } : {}), ...(detail && r.details_json !== null ? { details: JSON.parse(String(r.details_json)) as unknown } : {}) };
  }
  receipt(operationId: string): (CommandReceipt & { fingerprint: string }) | null {
    const r = this.one('SELECT * FROM command_receipts WHERE operation_id=?', operationId); if (!r) return null;
    const run = this.one('SELECT run_id FROM planning_receipt_runs WHERE operation_id=?', operationId);
    const review = this.one('SELECT review_id FROM review_receipts WHERE operation_id=?', operationId);
    return { operationId, kind: r.command_kind as CommandReceipt['kind'], fingerprint: String(r.fingerprint), srId: String(r.sr_id), changed: r.changed === 1, committedAt: String(r.committed_at), ...(review ? { reviewId: String(review.review_id) } : {}), ...(run ? { runId: String(run.run_id) } : {}), ...(r.document_id ? { ref: { srId: String(r.sr_id), documentId: String(r.document_id), versionId: String(r.version_id) } } : {}) };
  }
  review(srId: string, reviewId: string): ReviewRecord {
    this.sr(srId); const r = this.one('SELECT * FROM reviews WHERE id=?', reviewId);
    if (!r) fail('NOT_FOUND', '리뷰를 찾을 수 없습니다.');
    if (r.sr_id !== srId) fail('REFERENCE_MISMATCH', '다른 SR의 리뷰입니다.');
    return JSON.parse(String(r.payload)) as ReviewRecord;
  }
  workflow(srId: string): WorkflowState | null { this.sr(srId); const r = this.one('SELECT payload FROM planning_workflows WHERE sr_id=?', srId); return r ? JSON.parse(String(r.payload)) as WorkflowState : null; }
  run(srId: string, runId: string): PlanningRun {
    this.sr(srId); const r = this.one('SELECT * FROM planning_runs WHERE id=?', runId);
    if (!r) fail('NOT_FOUND', '실행을 찾을 수 없습니다.');
    if (r.sr_id !== srId) fail('REFERENCE_MISMATCH', '다른 SR의 실행입니다.');
    return JSON.parse(String(r.payload)) as PlanningRun;
  }
  read<Q extends ReadQuery>(query: Q): ReadResults[Q['kind']] { return this.dispatch(query) as ReadResults[Q['kind']]; }
  private dispatch(q: ReadQuery): ReadResults[keyof ReadResults] {
    if (q.kind === 'review') return this.review(q.srId, q.reviewId);
    if (q.kind === 'workflow') return this.workflow(q.srId);
    if (q.kind === 'run') return this.run(q.srId, q.runId);
    if (q.kind === 'runningRuns') return this.all("SELECT payload FROM planning_runs WHERE status='running'").map(r => JSON.parse(String(r.payload)) as PlanningRun);
    if (q.kind === 'sr') return this.sr(q.srId);
    if (q.kind === 'document') return this.document(q.srId, q.documentId);
    if (q.kind === 'version') return this.version(q.target);
    if (q.kind === 'receipt') return this.receipt(q.operationId);
    if (q.kind === 'documentKey') { this.sr(q.srId); const r = this.one('SELECT * FROM documents WHERE sr_id=? AND logical_key=?', q.srId, q.logicalKey); return r ? document(r) : null; }
    if (q.kind === 'event') {
      this.sr(q.srId); const r = this.one('SELECT * FROM history_events WHERE id=?', q.eventId);
      if (!r) fail('NOT_FOUND', '사건을 찾을 수 없습니다.'); if (r.sr_id !== q.srId) fail('REFERENCE_MISMATCH', '다른 SR의 사건입니다.'); return this.event(r, true);
    }
    const scope = JSON.stringify([q.kind, 'srId' in q ? q.srId : null, 'documentId' in q ? q.documentId ?? null : null]);
    const { limit, key } = paging(scope, q.options);
    if (q.kind === 'board') {
      cursorKey(key, ['string', 'string']);
      const rows = this.all(`SELECT id,title,created_at,workflow_column FROM srs ${key ? 'WHERE (created_at,id)<(?,?)' : ''} ORDER BY created_at DESC,id DESC LIMIT ?`, ...(key ?? []), limit + 1);
      return page(rows.map(r => { const w = this.workflow(String(r.id)); const pendingReviews = Number(this.one("SELECT COUNT(*) AS n FROM reviews WHERE sr_id=? AND status='requested'", String(r.id))?.n ?? 0); return { id: String(r.id), title: String(r.title), createdAt: String(r.created_at), column: r.workflow_column as SRSummary['column'], pendingReviews, ...(w ? { inceptionCycle: w.inceptionCycle, constructionCycle: w.constructionCycle, planningStatus: w.status } : {}) }; }), limit, scope, r => [r.createdAt, r.id]);
    }
    this.sr(q.srId);
    if (q.kind === 'reviews') {
      cursorKey(key, ['string', 'string']);
      const rows = this.all(`SELECT payload FROM reviews WHERE sr_id=? ${key ? 'AND (requested_at,id)<(?,?)' : ''} ORDER BY requested_at DESC,id DESC LIMIT ?`, q.srId, ...(key ?? []), limit + 1);
      return page(rows.map(r => JSON.parse(String(r.payload)) as ReviewRecord), limit, scope, r => [r.requestedAt, r.id]);
    }
    if (q.kind === 'documents') {
      cursorKey(key, ['string', 'string']);
      const rows = this.all(`SELECT ${versionColumns},d.logical_key,d.created_at AS doc_created FROM documents d JOIN document_versions v ON v.id=d.latest_version_id WHERE d.sr_id=? ${key ? 'AND (d.created_at,d.id)>(?,?)' : ''} ORDER BY d.created_at,d.id LIMIT ?`, q.srId, ...(key ?? []), limit + 1);
      const p = page(rows, limit, scope, r => [String(r.doc_created), String(r.document_id)]);
      return { ...p, items: p.items.map((r): DocumentSummary => ({ ...summary(r), logicalKey: String(r.logical_key), latestVersionRef: ref(r) })) };
    }
    if (q.documentId) this.document(q.srId, q.documentId);
    cursorKey(key, ['number']);
    if (q.kind === 'versions') {
      const rows = this.all(`SELECT ${versionColumns} FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.sr_id=? AND v.document_id=? ${key ? 'AND v.version_number<?' : ''} ORDER BY v.version_number DESC LIMIT ?`, q.srId, q.documentId, ...(key ?? []), limit + 1);
      return page(rows.map(summary), limit, scope, r => [r.versionNumber]);
    }
    const rows = this.all(`SELECT e.id,e.sr_id,e.sequence,e.kind,e.actor_source,e.actor_role,e.occurred_at,e.summary FROM history_events e WHERE e.sr_id=? ${q.documentId ? 'AND EXISTS(SELECT 1 FROM event_version_refs r WHERE r.sr_id=e.sr_id AND r.event_id=e.id AND r.document_id=?)' : ''} ${key ? 'AND e.sequence<?' : ''} ORDER BY e.sequence DESC LIMIT ?`, q.srId, ...(q.documentId ? [q.documentId] : []), ...(key ?? []), limit + 1);
    return page(rows.map(r => this.event(r)), limit, scope, r => [r.sequence]);
  }
}
