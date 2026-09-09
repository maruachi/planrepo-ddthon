import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { testDB } from '../sr-document-foundation/helpers/test-db.js';
import { srFixture, documentFixture } from '../sr-document-foundation/helpers/fixtures.js';
import { foundationSQL } from '../../src/sr-document-foundation/storage/migrations/001-foundation.js';
import { SQLiteStore } from '../../src/sr-document-foundation/storage/sqlite-store.js';
import { openDatabase } from '../../src/sr-document-foundation/storage/database.js';
import { emptyChanges } from '../../src/sr-document-foundation/storage/store-port.js';
import { initialWorkflow } from '../../src/aidlc-planning/policy/planning-policy.js';
import { unwrap } from '../../src/shared/errors.js';

it('migrates a populated v1 database preserving original inputs, versions, events, and receipts', () => {
  const t = testDB(); const path = join(t.dir, 'legacy.sqlite');
  let db = new Database(path);
  try {
    db.pragma('foreign_keys = ON'); db.exec(foundationSQL); db.pragma('user_version = 1');
    const store = new SQLiteStore(db); const first = srFixture();
    first.sr!.description = ' 공백과 한글\r\n둘째 줄\n'; first.sr!.attachmentMarkdown = '# 첨부\r\n원문';
    first.command = { operationId: randomUUID(), kind: 'create', fingerprint: 'legacy-create' };
    first.outcome = { kind: 'create', srId: first.sr!.id, changed: true };
    unwrap(store.commit(first));
    const document = documentFixture(first.sr!.id, ' 문서 원문\r\n\t내용\n'); unwrap(store.commit(document));
    const tables = ['srs', 'documents', 'document_versions', 'history_events', 'event_version_refs', 'command_receipts'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    db.close(); db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    const after = tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    expect((after[0] as { manual_board_column: null }[]).every(row => row.manual_board_column === null)).toBe(true);
    after[0] = (after[0] as Record<string, unknown>[]).map(({ manual_board_column: _, ...row }) => row);
    expect(after).toEqual(before);
    const migrated = new SQLiteStore(db);
    expect(unwrap(migrated.read({ kind: 'receipt', operationId: first.command.operationId }))).toMatchObject({ fingerprint: 'legacy-create', kind: 'create' });
    expect(unwrap(migrated.read({ kind: 'version', target: document.pointers[0]! })).body).toBe(' 문서 원문\r\n\t내용\n');
    expect(db.prepare('SELECT * FROM planning_version_runs').all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { if (db.open) db.close(); t.close(); }
});

it('rolls back workflow, run, documents and events when a completion contains an invalid version', () => {
  const t = testDB();
  try {
    const first = srFixture(); unwrap(t.store.commit(first)); const srId = first.sr!.id;
    const runId = randomUUID(); const start = emptyChanges();
    const state = { ...initialWorkflow(srId), revision: 1, latestRunId: runId, status: 'running' as const, column: 'requirements_analysis' as const };
    const run = { id: runId, srId, stage: 'requirements-analysis' as const, status: 'running' as const, startedAt: '2026-09-09T00:00:00Z', inputRefs: [], outputRefs: [] };
    start.planning = { expectedRevision: null, state, run }; unwrap(t.store.commit(start));
    const completed = documentFixture(srId, '본문'); completed.versions[0]!.runId = runId;
    completed.versions[0]!.title = '';
    completed.planning = { expectedRevision: 1, state: { ...state, revision: 2, status: 'awaiting_approval', reviewTargets: completed.pointers }, run: { ...run, status: 'succeeded', completedAt: '2026-09-09T00:01:00Z', outputRefs: completed.pointers } };
    expect(t.store.commit(completed).ok).toBe(false);
    expect(unwrap(t.store.read({ kind: 'workflow', srId }))).toEqual(state);
    expect(unwrap(t.store.read({ kind: 'run', srId, runId }))).toEqual(run);
    expect(unwrap(t.store.read({ kind: 'documents', srId })).items).toEqual([]);
    expect(unwrap(t.store.read({ kind: 'history', srId })).items).toHaveLength(1);
    expect(t.db.prepare('SELECT * FROM planning_version_runs').all()).toEqual([]);
    expect(t.db.pragma('foreign_key_check')).toEqual([]);
  } finally { t.close(); }
});
