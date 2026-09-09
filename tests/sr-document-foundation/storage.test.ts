import { afterEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDB } from './helpers/test-db.js';
import { documentFixture, srFixture } from './helpers/fixtures.js';
import { openDatabase } from '../../src/sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../../src/sr-document-foundation/storage/sqlite-store.js';
import { emptyChanges } from '../../src/sr-document-foundation/storage/store-port.js';
import { unwrap } from '../../src/shared/errors.js';
const cleanups: (() => void)[] = []; afterEach(() => { cleanups.splice(0).forEach(f => f()); });
function setup() { const t = testDB(); cleanups.push(t.close); const c = srFixture(); unwrap(t.store.commit(c)); const sr = c.sr!; const d = documentFixture(sr.id); unwrap(t.store.commit(d)); return { ...t, sr, ref: d.pointers[0] }; }
test('real-file reopen preserves exact input, immutable version and references', () => {
  const t = setup(); const before = unwrap(t.store.read({ kind: 'version', target: t.ref })); t.db.close();
  const db = openDatabase(t.path); const store = new SQLiteStore(db);
  try { expect(unwrap(store.read({ kind: 'version', target: t.ref }))).toEqual(before); expect(unwrap(store.read({ kind: 'sr', srId: t.sr.id })).attachmentMarkdown).toBe(''); } finally { db.close(); }
});
test('mid-insert failure rolls back new document, version and events', () => {
  const t = setup(); const c = documentFixture(t.sr.id); c.events[0].id = unwrap(t.store.read({ kind: 'history', srId: t.sr.id })).items[0].id;
  expect(t.store.commit(c).ok).toBe(false); expect(unwrap(t.store.read({ kind: 'documents', srId: t.sr.id })).items).toHaveLength(1);
  expect(t.db.prepare('SELECT count(*) AS n FROM document_versions').get()).toEqual({ n: 1 });
});
test('deferred FK commit error rolls back the whole transaction', () => {
  const t = setup();
  expect(() => t.db.transaction(() => { t.db.prepare('UPDATE documents SET latest_version_id=? WHERE id=?').run(randomUUID(), t.ref.documentId); t.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run(randomUUID(), t.sr.id, 'invalid', randomUUID(), 'now'); }).immediate()).toThrow();
  expect(unwrap(t.store.read({ kind: 'version', target: t.ref })).isLatest).toBe(true); expect(unwrap(t.store.read({ kind: 'documents', srId: t.sr.id })).items).toHaveLength(1);
});
test('immutable records reject updates and deletes', () => {
  const t = setup(); for (const table of ['document_versions', 'history_events', 'event_version_refs']) {
    expect(() => t.db.exec(`DELETE FROM ${table}`)).toThrow('immutable');
  }
  expect(() => t.db.prepare('UPDATE document_versions SET body=?').run('changed')).toThrow('immutable');
  expect(() => t.db.prepare('UPDATE srs SET title=?').run('changed')).toThrow('immutable');
});
test('cross-SR references and incorrect latest pointers never partially commit', () => {
  const t = setup(); const other = srFixture(); unwrap(t.store.commit(other));
  const c = documentFixture(other.sr!.id); c.events[0].versionRefs = [t.ref];
  expect(t.store.commit(c)).toMatchObject({ ok: false, error: { code: 'REFERENCE_MISMATCH' } });
  expect(unwrap(t.store.read({ kind: 'documents', srId: other.sr!.id })).items).toEqual([]);
  const bad = documentFixture(t.sr.id); bad.pointers[0].versionId = randomUUID(); expect(t.store.commit(bad).ok).toBe(false);
});
test('second connection lock fails explicitly and preserves original data', () => {
  const t = setup(); const second = openDatabase(t.path); second.exec('BEGIN IMMEDIATE');
  try { expect(t.store.commit(srFixture())).toMatchObject({ ok: false, error: { code: 'STORAGE_BUSY' } }); } finally { second.exec('ROLLBACK'); second.close(); }
  expect(unwrap(t.store.read({ kind: 'board' })).items).toHaveLength(1);
});
test('receipt and records are atomic; replay preserves original result', () => {
  const t = setup(); const c = emptyChanges(); c.expected = [t.ref]; c.command = { operationId: randomUUID(), kind: 'edit', fingerprint: 'a' }; c.outcome = { kind: 'edit', srId: t.sr.id, ref: t.ref, changed: false };
  const first = unwrap(t.store.commit(c)); expect(unwrap(t.store.commit(c))).toEqual(first);
  expect(() => t.db.exec('DELETE FROM command_receipts')).toThrow('immutable');
  c.command.fingerprint = 'b'; expect(t.store.commit(c)).toMatchObject({ ok: false, error: { code: 'OPERATION_CONFLICT' } });
});
test('receipt survives reopening with exact original result and replay protection', () => {
  const t = setup(); const c = emptyChanges(); c.expected = [t.ref]; c.command = { operationId: randomUUID(), kind: 'edit', fingerprint: 'persisted' }; c.outcome = { kind: 'edit', srId: t.sr.id, ref: t.ref, changed: false };
  const receipt = unwrap(t.store.commit(c)); t.db.close(); const db = openDatabase(t.path); const store = new SQLiteStore(db);
  try { expect(unwrap(store.commit(c))).toEqual(receipt); expect(unwrap(store.read({ kind: 'receipt', operationId: c.command.operationId }))).toMatchObject({ ...receipt, fingerprint: 'persisted' }); } finally { db.close(); }
});
test('manual board movement is atomic, persistent and independent from workflow_column', () => {
  const t = setup(); const operationId = randomUUID(); const c = emptyChanges();
  c.requireSrs.push(t.sr.id); c.boardMovement = { srId: t.sr.id, expectedColumn: 'sr_list', targetColumn: 'requirements_analysis' };
  c.command = { operationId, kind: 'move_board', fingerprint: 'move' }; c.outcome = { kind: 'move_board', srId: t.sr.id, changed: true };
  expect(unwrap(t.store.commit(c))).toMatchObject({ operationId, kind: 'move_board' });
  expect(unwrap(t.store.read({ kind: 'boardItem', srId: t.sr.id })).column).toBe('requirements_analysis');
  expect(unwrap(t.store.read({ kind: 'sr', srId: t.sr.id })).column).toBe('sr_list');
  const stale = emptyChanges(); stale.requireSrs.push(t.sr.id); stale.boardMovement = { srId: t.sr.id, expectedColumn: 'sr_list', targetColumn: 'requirements_analysis' };
  expect(t.store.commit(stale)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_CONFLICT' } });
  t.db.close(); const db = openDatabase(t.path); const store = new SQLiteStore(db);
  try { expect(unwrap(store.read({ kind: 'boardItem', srId: t.sr.id })).column).toBe('requirements_analysis'); expect(unwrap(store.commit(c))).toMatchObject({ operationId }); }
  finally { db.close(); }
});
