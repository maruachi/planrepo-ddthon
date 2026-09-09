import type Database from 'better-sqlite3';
import type { CommandReceipt, Result, VersionRef } from '../../shared/contracts.js';
import { errorOf, fail, result } from '../../shared/errors.js';
import { Queries } from './queries.js';
import type { ChangeSet, ReadQuery, ReadResults, StorePort } from './store-port.js';
export class SQLiteStore implements StorePort {
  readonly queries: Queries;
  constructor(readonly db: Database.Database) { this.queries = new Queries(db); }
  read<Q extends ReadQuery>(q: Q): Result<ReadResults[Q['kind']]> { return result(() => this.queries.read(q)); }
  commit(changes: ChangeSet): Result<CommandReceipt | null> {
    try { return { ok: true, data: this.db.transaction(() => this.write(changes)).immediate() }; }
    catch (error) {
      const code = String((error as { code?: string })?.code ?? '');
      let uncertain = code.startsWith('SQLITE_IOERR');
      if (this.db.open && this.db.inTransaction) { try { this.db.exec('ROLLBACK'); } catch { uncertain = true; } }
      if (uncertain) { if (this.db.open) this.db.close(); return { ok: false, error: { code: 'OUTCOME_UNKNOWN', message: '저장 결과를 확인하지 못했습니다. 앱을 재시작한 뒤 결과를 다시 확인해 주세요.' } }; }
      return { ok: false, error: errorOf(error, 'STORAGE_FAILED') };
    }
  }
  private next(table: 'document_versions' | 'history_events', column: 'version_number' | 'sequence', key: 'document_id' | 'sr_id', id: string): number {
    const n = Number(this.queries.one(`SELECT COALESCE(MAX(${column}),0)+1 AS n FROM ${table} WHERE ${key}=?`, id)?.n);
    if (!Number.isSafeInteger(n) || n < 1) fail('STORAGE_FAILED', '저장 순서 범위를 초과했습니다.'); return n;
  }
  private write(c: ChangeSet): CommandReceipt | null {
    const q = this.queries;
    if (c.command) {
      const old = q.receipt(c.command.operationId);
      if (old) { if (old.fingerprint !== c.command.fingerprint || old.kind !== c.command.kind) fail('OPERATION_CONFLICT', '같은 요청 식별자에 다른 내용이 있습니다.'); const { fingerprint: _, ...receipt } = old; return receipt; }
      if (!c.outcome || c.outcome.kind !== c.command.kind) fail('STORAGE_FAILED', '명령 결과 계약이 일치하지 않습니다.');
    }
    for (const srId of c.requireSrs) q.sr(srId);
    if (c.review) {
      if (c.planning) fail('STORAGE_FAILED', '리뷰는 계획 상태를 변경하지 않습니다.');
      const { review, expectedStatus } = c.review; const sr = q.sr(review.srId);
      if (review.target.srId !== review.srId) fail('REFERENCE_MISMATCH', '리뷰 대상 SR이 다릅니다.');
      q.version(review.target);
      if (expectedStatus === null) {
        if (!['inception', 'construction'].includes(sr.column) || review.status !== 'requested') fail('REVIEW_CONFLICT', '계획 중인 SR에 리뷰를 요청해 주세요.');
        this.db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?,?,?)').run(review.id, review.srId, review.target.documentId, review.target.versionId, review.requestedAt, review.status, JSON.stringify(review));
      } else {
        const old = q.review(review.srId, review.id);
        if (old.status !== expectedStatus || review.status === 'requested' || JSON.stringify(old.target) !== JSON.stringify(review.target) || old.requestedAt !== review.requestedAt || old.requestComment !== review.requestComment) fail('REVIEW_CONFLICT', '리뷰 상태가 변경되었습니다. 다시 확인해 주세요.');
        this.db.prepare('UPDATE reviews SET status=?,payload=? WHERE id=?').run(review.status, JSON.stringify(review), review.id);
      }
    }
    if (c.expectedDocumentSet) {
      const rows = q.all('SELECT id,latest_version_id FROM documents WHERE sr_id=? ORDER BY id', c.expectedDocumentSet.srId);
      const refs = [...c.expectedDocumentSet.refs].sort((a, b) => a.documentId.localeCompare(b.documentId));
      if (rows.length !== refs.length || rows.some((r, i) => r.id !== refs[i].documentId || r.latest_version_id !== refs[i].versionId || refs[i].srId !== c.expectedDocumentSet!.srId)) fail('VERSION_CONFLICT', '실행 중 문서가 변경되었습니다. 최신 문맥으로 다시 생성해 주세요.');
    }
    if (c.planning) {
      const { state, expectedRevision, run } = c.planning; const old = q.workflow(state.srId);
      if ((old?.revision ?? null) !== expectedRevision || state.revision !== (old?.revision ?? 0) + 1 || !Number.isSafeInteger(state.revision)) fail('WORKFLOW_CONFLICT', '계획 상태가 변경되었습니다. 최신 상태를 확인해 주세요.');
      if (run) {
        if (run.srId !== state.srId || run.id !== state.latestRunId) fail('REFERENCE_MISMATCH', '실행과 계획 소속이 다릅니다.');
        const existing = q.one('SELECT sr_id FROM planning_runs WHERE id=?', run.id);
        if (existing) {
          const prior = q.run(state.srId, run.id);
          if (prior.status !== 'running' || run.status === 'running' || prior.stage !== run.stage || prior.startedAt !== run.startedAt || JSON.stringify(prior.inputRefs) !== JSON.stringify(run.inputRefs) || JSON.stringify(prior.context) !== JSON.stringify(run.context)) fail('WORKFLOW_CONFLICT', '실행 상태나 입력이 변경되었습니다.');
          this.db.prepare('UPDATE planning_runs SET status=?,payload=? WHERE id=?').run(run.status, JSON.stringify(run), run.id);
        } else {
          if (run.status !== 'running') fail('WORKFLOW_CONFLICT', '시작 기록이 없는 실행입니다.');
          for (const r of run.inputRefs) { if (r.srId !== run.srId) fail('REFERENCE_MISMATCH', '실행 입력 소속이 다릅니다.'); q.version(r); }
          this.db.prepare('INSERT INTO planning_runs VALUES (?,?,?,?)').run(run.id, run.srId, run.status, JSON.stringify(run));
        }
      }
      this.db.prepare('INSERT INTO planning_workflows VALUES (?,?,?,?) ON CONFLICT(sr_id) DO UPDATE SET revision=excluded.revision,latest_run_id=excluded.latest_run_id,payload=excluded.payload').run(state.srId, state.revision, state.latestRunId ?? null, JSON.stringify(state));
      this.db.prepare('UPDATE srs SET workflow_column=? WHERE id=?').run(state.column, state.srId);
    }
    for (const expected of c.expected) {
      q.version(expected);
      const d = q.document(expected.srId, expected.documentId);
      if (d.latestVersionId !== expected.versionId) fail('VERSION_CONFLICT', '최신 버전이 변경되었습니다. 초안을 유지하고 확인해 주세요.', { currentVersionRef: { srId: d.srId, documentId: d.id, versionId: d.latestVersionId } });
    }
    const newDocs = new Set(c.documents.map(d => d.id));
    for (const d of c.documents) {
      if (q.one('SELECT id FROM documents WHERE sr_id=? AND logical_key=?', d.srId, d.logicalKey)) fail('VERSION_CONFLICT', '문서 키가 이미 사용 중입니다.');
      if (!c.versions.some(v => v.documentId === d.id && v.srId === d.srId && v.versionId === d.latestVersionId)) fail('STORAGE_FAILED', '첫 버전 참조가 없습니다.');
    }
    for (const v of c.versions) {
      if (!newDocs.has(v.documentId) && !c.expected.some(e => e.srId === v.srId && e.documentId === v.documentId)) fail('STORAGE_FAILED', '최신 전제가 없습니다.');
      for (const versionId of [v.baseVersionId, v.sourceVersionId]) if (versionId) q.version({ srId: v.srId, documentId: v.documentId, versionId });
      if (!c.pointers.some(p => p.srId === v.srId && p.documentId === v.documentId && p.versionId === v.versionId)) fail('STORAGE_FAILED', '새 버전의 최신 변경이 없습니다.');
    }
    if (c.sr) {
      const s = c.sr;
      this.db.prepare('INSERT INTO srs VALUES (?,?,?,?,?,?,?,?,?)').run(s.id, s.title, s.description, s.attachmentMarkdown ?? null, s.attachmentDisplayName ?? null, s.createdAt, s.actor.source, s.actor.role ?? null, s.column);
    }
    for (const d of c.documents) this.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run(d.id, d.srId, d.logicalKey, d.latestVersionId, d.createdAt);
    for (const v of c.versions) this.db.prepare('INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(v.versionId, v.srId, v.documentId, this.next('document_versions', 'version_number', 'document_id', v.documentId), v.title, v.body, v.origin, v.createdAt, v.actor.source, v.actor.role ?? null, v.baseVersionId ?? null, v.sourceVersionId ?? null, v.runId ?? null);
    if (c.planning) {
      for (const v of c.versions) {
        if (!v.runId || v.runId !== c.planning.run?.id || v.srId !== c.planning.state.srId || c.planning.run.status !== 'succeeded') fail('REFERENCE_MISMATCH', '생성 버전과 완료 실행의 연결이 필요합니다.');
        this.db.prepare('INSERT INTO planning_version_runs VALUES (?,?,?,?)').run(v.srId, v.documentId, v.versionId, v.runId);
      }
      for (const r of [...c.planning.state.reviewTargets, ...(c.planning.run?.outputRefs ?? []), ...(c.planning.state.decision?.targets ?? [])]) {
        if (r.srId !== c.planning.state.srId) fail('REFERENCE_MISMATCH', '계획과 버전 소속이 다릅니다.'); q.version(r);
      }
    }
    for (const p of c.pointers) {
      const expected = c.expected.find(e => e.srId === p.srId && e.documentId === p.documentId);
      if (!newDocs.has(p.documentId) && !expected) fail('STORAGE_FAILED', '최신 변경 전제가 없습니다.');
      q.version(p);
      const changed = this.db.prepare('UPDATE documents SET latest_version_id=? WHERE sr_id=? AND id=? AND latest_version_id=?').run(p.versionId, p.srId, p.documentId, expected?.versionId ?? p.versionId).changes;
      if (changed !== 1) fail('VERSION_CONFLICT', '최신 참조가 변경되었습니다.');
    }
    for (const e of c.events) {
      this.db.prepare('INSERT INTO history_events VALUES (?,?,?,?,?,?,?,?,?,?)').run(e.id, e.srId, this.next('history_events', 'sequence', 'sr_id', e.srId), e.kind, e.actor.source, e.actor.role ?? null, e.occurredAt, e.summary, e.subject === undefined ? null : JSON.stringify(e.subject), e.details === undefined ? null : JSON.stringify(e.details));
      const seen = new Set<string>();
      for (const r of e.versionRefs) {
        if (r.srId !== e.srId) fail('REFERENCE_MISMATCH', '사건과 버전의 SR이 다릅니다.');
        q.version(r);
        if (!seen.has(r.versionId)) { this.db.prepare('INSERT INTO event_version_refs VALUES (?,?,?,?)').run(r.srId, e.id, r.documentId, r.versionId); seen.add(r.versionId); }
      }
    }
    if (!c.outcome) return null;
    q.sr(c.outcome.srId);
    if (c.outcome.ref) { if (c.outcome.ref.srId !== c.outcome.srId) fail('REFERENCE_MISMATCH', '결과 소속이 다릅니다.'); q.version(c.outcome.ref); }
    const receipt: CommandReceipt = { ...c.outcome, committedAt: new Date().toISOString(), ...(c.command ? { operationId: c.command.operationId } : {}) };
    if (c.command) this.db.prepare('INSERT INTO command_receipts VALUES (?,?,?,?,?,?,?,?)').run(c.command.operationId, c.command.kind, c.command.fingerprint, receipt.srId, receipt.ref?.documentId ?? null, receipt.ref?.versionId ?? null, Number(receipt.changed), receipt.committedAt);
    if (c.command && receipt.runId) this.db.prepare('INSERT INTO planning_receipt_runs VALUES (?,?,?)').run(c.command.operationId, receipt.srId, receipt.runId);
    if (c.command && receipt.reviewId) this.db.prepare('INSERT INTO review_receipts VALUES (?,?,?)').run(c.command.operationId, receipt.srId, receipt.reviewId);
    return receipt;
  }
}
