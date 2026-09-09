import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { testDB } from '../sr-document-foundation/helpers/test-db.js';
import { srFixture, documentFixture } from '../sr-document-foundation/helpers/fixtures.js';
import { foundationSQL } from '../../src/sr-document-foundation/storage/migrations/001-foundation.js';
import { planningSQL } from '../../src/sr-document-foundation/storage/migrations/002-planning.js';
import { SQLiteStore } from '../../src/sr-document-foundation/storage/sqlite-store.js';
import { openDatabase } from '../../src/sr-document-foundation/storage/database.js';
import { emptyChanges } from '../../src/sr-document-foundation/storage/store-port.js';
import { initialWorkflow } from '../../src/aidlc-planning/policy/planning-policy.js';
import type { PlanningRun, WorkflowState } from '../../src/shared/planning-contracts.js';
import { unwrap } from '../../src/shared/errors.js';

it('migrates populated v2 preserving run context, original input, generated versions, decisions and operation receipts', () => {
  const t = testDB(); let db = new Database(join(t.dir, 'legacy-v2.sqlite'));
  try {
    db.pragma('foreign_keys = ON'); db.exec(foundationSQL); db.exec(planningSQL); db.pragma('user_version = 2');
    const store = new SQLiteStore(db); const first = srFixture();
    first.sr!.description = ' 한글 원문\r\n둘째 줄\n'; first.sr!.attachmentMarkdown = '# 첨부\r\n원본';
    unwrap(store.commit(first)); const sr = first.sr!;
    const input = documentFixture(sr.id, '최초 입력 버전\r\n'); unwrap(store.commit(input));
    const runId = randomUUID();
    const workflow: WorkflowState = { ...initialWorkflow(sr.id), column: 'requirements_analysis', status: 'running', revision: 1, latestRunId: runId };
    const run: PlanningRun = { id: runId, srId: sr.id, stage: 'requirements-analysis', status: 'running', startedAt: sr.createdAt, inputRefs: input.pointers, outputRefs: [], context: { sr, runId, stage: 'requirements-analysis', workflow, documents: [{ ...unwrap(store.read({ kind: 'version', target: input.pointers[0]! })), logicalKey: input.documents[0]!.logicalKey }], history: [], rules: '기존 실행 규칙\r\n', scope: 'planning-only', finalize: false } };
    const start = emptyChanges(); start.planning = { expectedRevision: null, state: workflow, run }; unwrap(store.commit(start));
    const generated = documentFixture(sr.id, '생성 결과 보존\r\n'); generated.versions[0]!.runId = runId;
    const finished: PlanningRun = { ...run, status: 'succeeded', outputRefs: generated.pointers, completedAt: sr.createdAt, summary: '완료' };
    const completed: WorkflowState = { ...workflow, revision: 2, status: 'awaiting_approval', reviewTargets: generated.pointers };
    generated.planning = { expectedRevision: 1, state: completed, run: finished }; unwrap(store.commit(generated));
    const approve = emptyChanges(); approve.planning = { expectedRevision: 2, state: { ...completed, revision: 3, status: 'approved', decision: { id: randomUUID(), stage: 'requirements-analysis', runId, kind: 'approve', comment: '검토 승인\r\n', targets: generated.pointers, createdAt: sr.createdAt } } }; unwrap(store.commit(approve));
    const operationId = randomUUID();
    db.prepare('INSERT INTO command_receipts VALUES (?,?,?,?,?,?,?,?)').run(operationId, 'planning_advance', 'v2-fingerprint', sr.id, null, null, 1, sr.createdAt);
    db.prepare('INSERT INTO planning_receipt_runs VALUES (?,?,?)').run(operationId, sr.id, runId);
    const tables = ['srs', 'documents', 'document_versions', 'history_events', 'event_version_refs', 'command_receipts', 'planning_runs', 'planning_workflows', 'planning_version_runs', 'planning_receipt_runs'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    db.close(); db = openDatabase(join(t.dir, 'legacy-v2.sqlite'));
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(before);
    const migrated = new SQLiteStore(db);
    expect(unwrap(migrated.read({ kind: 'run', srId: sr.id, runId }))).toEqual(finished);
    expect(unwrap(migrated.read({ kind: 'receipt', operationId }))).toMatchObject({ runId, fingerprint: 'v2-fingerprint' });
    expect(unwrap(migrated.read({ kind: 'reviews', srId: sr.id })).items).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { if (db.open) db.close(); t.close(); }
});
