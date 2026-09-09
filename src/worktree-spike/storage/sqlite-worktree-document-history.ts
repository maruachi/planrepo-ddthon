import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { fail } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import type {
  WorktreeDocumentEditResult,
  WorktreeDocumentHistoryPort,
  WorktreeDocumentSnapshot,
  WorktreeDocumentSummary,
  WorktreeDocumentVersionSummary,
  WorktreeDocumentVersionView,
} from '../contracts.js';
import { isEditableWorktreeDocumentPath, validateWorktreeDocumentPath } from '../files/worktree-document-reader.js';

const SHA256 = /^[a-f0-9]{64}$/u;

interface VersionRow {
  id: string;
  sr_id: string;
  path: string;
  version_number: number;
  hash: string;
  body: string;
  origin: 'ai_generated' | 'human_edit';
  created_at: string;
  previous_version_id: string | null;
  source_operation_id: string | null;
  latest_version_id: string;
  latest_change: 'created' | 'modified' | 'unchanged';
}

interface ReceiptRow {
  fingerprint: string;
  sr_id: string;
  path: string;
  version_id: string;
  changed: number;
}

const hashBody = (body: string) => createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');

function validateSnapshot(snapshot: WorktreeDocumentSnapshot): void {
  validateWorktreeDocumentPath(snapshot.path);
  if (!SHA256.test(snapshot.hash) || hashBody(snapshot.body) !== snapshot.hash) fail('VALIDATION_ERROR', '문서 본문과 SHA-256이 일치하지 않습니다.');
  if (new TextEncoder().encode(snapshot.body).byteLength > LIMITS.text) fail('PAYLOAD_TOO_LARGE', 'Worktree 문서는 최대 1 MiB까지 저장할 수 있습니다.');
}

function version(row: VersionRow): WorktreeDocumentVersionView {
  return {
    srId: row.sr_id,
    path: row.path,
    versionId: row.id,
    versionNumber: row.version_number,
    hash: row.hash,
    body: row.body,
    origin: row.origin,
    createdAt: row.created_at,
    ...(row.previous_version_id ? { previousVersionId: row.previous_version_id } : {}),
    ...(row.source_operation_id ? { sourceOperationId: row.source_operation_id } : {}),
    isLatest: row.id === row.latest_version_id,
    change: row.latest_change,
    editable: isEditableWorktreeDocumentPath(row.path),
  };
}

export class SQLiteWorktreeDocumentHistory implements WorktreeDocumentHistoryPort {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly nextId: () => string = () => randomUUID(),
  ) {}

  recordSnapshot(snapshot: WorktreeDocumentSnapshot): WorktreeDocumentVersionView {
    validateSnapshot(snapshot);
    return this.db.transaction(() => this.append(snapshot)) .immediate();
  }

  listDocuments(srId: string): WorktreeDocumentSummary[] {
    const rows = this.db.prepare(`SELECT v.*,d.latest_version_id,d.latest_change
      FROM worktree_documents d JOIN worktree_document_versions v ON v.sr_id=d.sr_id AND v.id=d.latest_version_id
      WHERE d.sr_id=? ORDER BY d.path`).all(srId) as VersionRow[];
    return rows.map(row => {
      const current = version(row);
      const { body: _body, isLatest: _isLatest, ...summary } = current;
      return summary;
    });
  }

  listVersions(srId: string, path: string): WorktreeDocumentVersionSummary[] {
    validateWorktreeDocumentPath(path);
    const rows = this.db.prepare(`SELECT v.*,d.latest_version_id,d.latest_change
      FROM worktree_documents d JOIN worktree_document_versions v ON v.sr_id=d.sr_id AND v.path=d.path
      WHERE d.sr_id=? AND d.path=? ORDER BY v.version_number DESC`).all(srId, path) as VersionRow[];
    if (!rows.length) fail('NOT_FOUND', 'Worktree 문서 이력을 찾을 수 없습니다.');
    return rows.map(row => {
      const current = version(row);
      const { body: _body, isLatest: _isLatest, change: _change, editable: _editable, ...summary } = current;
      return summary;
    });
  }

  readVersion(srId: string, path: string, versionId?: string): WorktreeDocumentVersionView {
    validateWorktreeDocumentPath(path);
    const row = this.db.prepare(`SELECT v.*,d.latest_version_id,d.latest_change
      FROM worktree_documents d JOIN worktree_document_versions v ON v.sr_id=d.sr_id AND v.path=d.path
      WHERE d.sr_id=? AND d.path=? AND v.id=COALESCE(?,d.latest_version_id)`)
      .get(srId, path, versionId ?? null) as VersionRow | undefined;
    if (!row) fail('NOT_FOUND', 'Worktree 문서 버전을 찾을 수 없습니다.');
    return version(row);
  }

  editReceipt(operationId: string, fingerprint: string): WorktreeDocumentEditResult | undefined {
    const row = this.db.prepare('SELECT fingerprint,sr_id,path,version_id,changed FROM worktree_document_edit_receipts WHERE operation_id=?')
      .get(operationId) as ReceiptRow | undefined;
    if (!row) return undefined;
    if (row.fingerprint !== fingerprint) fail('OPERATION_CONFLICT', '같은 작업 ID를 다른 요청에 사용할 수 없습니다.');
    return { view: this.readVersion(row.sr_id, row.path, row.version_id), changed: row.changed === 1 };
  }

  recordHumanEdit(input: WorktreeDocumentSnapshot & { operationId: string; fingerprint: string; expectedHash: string }): WorktreeDocumentEditResult {
    validateSnapshot(input);
    if (input.origin !== 'human_edit' || !SHA256.test(input.expectedHash)) fail('VALIDATION_ERROR', '올바른 Worktree 편집 기록이 필요합니다.');
    return this.db.transaction(() => {
      const replay = this.editReceipt(input.operationId, input.fingerprint);
      if (replay) return replay;
      const latest = this.readVersion(input.srId, input.path);
      if (latest.hash !== input.expectedHash) fail('VERSION_CONFLICT', '기록된 최신 Worktree 문서가 변경되었습니다. 다시 확인해 주세요.');
      const view = input.hash === latest.hash ? latest : this.append(input);
      const changed = view.versionId !== latest.versionId;
      this.db.prepare(`INSERT INTO worktree_document_edit_receipts
        (operation_id,fingerprint,sr_id,path,expected_hash,version_id,changed,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(input.operationId, input.fingerprint, input.srId, input.path, input.expectedHash, view.versionId, Number(changed), this.now());
      return { view, changed };
    }).immediate();
  }

  private append(snapshot: WorktreeDocumentSnapshot): WorktreeDocumentVersionView {
    const latest = this.db.prepare(`SELECT v.*,d.latest_version_id,d.latest_change
      FROM worktree_documents d JOIN worktree_document_versions v ON v.sr_id=d.sr_id AND v.id=d.latest_version_id
      WHERE d.sr_id=? AND d.path=?`).get(snapshot.srId, snapshot.path) as VersionRow | undefined;
    if (latest?.hash === snapshot.hash) {
      this.db.prepare('UPDATE worktree_documents SET latest_change=? WHERE sr_id=? AND path=?').run(snapshot.change, snapshot.srId, snapshot.path);
      return version({ ...latest, latest_change: snapshot.change });
    }
    if (!latest) this.db.prepare('INSERT INTO worktree_documents(sr_id,path,latest_version_id,latest_change) VALUES (?,?,NULL,?)').run(snapshot.srId, snapshot.path, snapshot.change);
    const versionId = this.nextId();
    const versionNumber = (latest?.version_number ?? 0) + 1;
    const createdAt = this.now();
    this.db.prepare(`INSERT INTO worktree_document_versions
      (id,sr_id,path,version_number,hash,body,origin,created_at,previous_version_id,source_operation_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(versionId, snapshot.srId, snapshot.path, versionNumber, snapshot.hash, snapshot.body, snapshot.origin, createdAt, latest?.id ?? null, snapshot.sourceOperationId ?? null);
    this.db.prepare('UPDATE worktree_documents SET latest_version_id=?,latest_change=? WHERE sr_id=? AND path=?')
      .run(versionId, snapshot.change, snapshot.srId, snapshot.path);
    return this.readVersion(snapshot.srId, snapshot.path, versionId);
  }
}
