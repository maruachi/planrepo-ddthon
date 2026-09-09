import { expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testDB } from './helpers/test-db.js';
import { openDatabase } from '../../src/sr-document-foundation/storage/database.js';
import { foundationSQL } from '../../src/sr-document-foundation/storage/migrations/001-foundation.js';
import { planningSQL } from '../../src/sr-document-foundation/storage/migrations/002-planning.js';
import { reviewSQL } from '../../src/sr-document-foundation/storage/migrations/003-reviews.js';
import { worktreeSpikeSQL } from '../../src/sr-document-foundation/storage/migrations/004-worktree-spike.js';
import { worktreeReviewSQL } from '../../src/sr-document-foundation/storage/migrations/005-worktree-reviews.js';
import { manualBoardColumnSQL } from '../../src/sr-document-foundation/storage/migrations/006-manual-board-column.js';
test('rejects unknown/newer/corrupt schemas while preserving original bytes', () => {
  const t = testDB(); try {
    for (const type of ['unknown', 'newer', 'corrupt']) {
      const path = join(t.dir, type + '.sqlite');
      if (type === 'corrupt') writeFileSync(path, 'not a sqlite database'); else { const db = new Database(path); db.exec('CREATE TABLE user_data (value TEXT)'); if (type === 'newer') db.pragma('user_version = 99'); db.close(); }
      const before = readFileSync(path); expect(() => openDatabase(path)).toThrow(); expect(readFileSync(path)).toEqual(before);
    }
  } finally { t.close(); }
});
test('supported schema rejects missing immutability protection', () => {
  const t = testDB(); t.db.exec('DROP TRIGGER document_versions_update'); t.db.close();
  try { expect(() => openDatabase(t.path)).toThrow('Unsupported schema structure'); } finally { t.close(); }
});
test('v5 migration preserves SR workflow state and adds board override plus empty worktree history', () => {
  const t = testDB(); const path = join(t.dir, 'legacy-v5.sqlite'); let db = new Database(path);
  try {
    db.exec(foundationSQL); db.exec(planningSQL); db.exec(reviewSQL); db.exec(worktreeSpikeSQL); db.exec(worktreeReviewSQL); db.pragma('user_version = 5');
    db.prepare('INSERT INTO srs VALUES (?,?,?,?,?,?,?,?,?)').run('legacy', '기존 SR', '원문', null, null, '2026-09-09T00:00:00Z', 'user', 'author', 'construction');
    db.close(); db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    expect(db.prepare('SELECT title,workflow_column,manual_board_column FROM srs WHERE id=?').get('legacy')).toEqual({ title: '기존 SR', workflow_column: 'construction', manual_board_column: null });
    expect(db.prepare('SELECT * FROM worktree_documents').all()).toEqual([]);
    expect(() => db.prepare('UPDATE srs SET manual_board_column=? WHERE id=?').run('invalid', 'legacy')).toThrow();
  } finally { if (db.open) db.close(); t.close(); }
});

test('v6 migration adds immutable worktree document history without changing existing rows', () => {
  const t = testDB(); const path = join(t.dir, 'legacy-v6.sqlite'); let db = new Database(path);
  try {
    db.exec(foundationSQL); db.exec(planningSQL); db.exec(reviewSQL); db.exec(worktreeSpikeSQL); db.exec(worktreeReviewSQL); db.exec(manualBoardColumnSQL); db.pragma('user_version = 6');
    db.prepare('INSERT INTO srs(id,title,description,created_at,actor_source,workflow_column,manual_board_column) VALUES (?,?,?,?,?,?,?)')
      .run('legacy-v6', '기존 SR', '원문', '2026-09-09T00:00:00Z', 'user', 'construction', 'peer_review');
    db.close(); db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(7);
    expect(db.prepare('SELECT title,manual_board_column FROM srs WHERE id=?').get('legacy-v6')).toEqual({ title: '기존 SR', manual_board_column: 'peer_review' });
    expect(db.prepare('SELECT * FROM worktree_document_versions').all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { if (db.open) db.close(); t.close(); }
});
