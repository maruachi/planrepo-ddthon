import Database from 'better-sqlite3';
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { worktreeDocumentHistorySQL } from '../../src/sr-document-foundation/storage/migrations/007-worktree-document-history.js';
import { SQLiteWorktreeDocumentHistory } from '../../src/worktree-spike/storage/sqlite-worktree-document-history.js';
import { worktreeDocumentSnapshotArbitrary, worktreeVersionBodiesArbitrary } from './manifest/generators.js';

const seed = 424242;
const database = () => {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); db.exec('CREATE TABLE srs(id TEXT PRIMARY KEY NOT NULL);'); db.exec(worktreeDocumentHistorySQL); db.prepare('INSERT INTO srs(id) VALUES (?)').run('sr-property'); return db;
};

test('PBT-02 valid Worktree snapshots round-trip exact Unicode body and version identity', () => {
  fc.assert(fc.property(worktreeDocumentSnapshotArbitrary, snapshot => {
    const db = database();
    try {
      const history = new SQLiteWorktreeDocumentHistory(db);
      const stored = history.recordSnapshot({ srId: 'sr-property', ...snapshot, change: 'created' });
      expect(history.readVersion('sr-property', snapshot.path, stored.versionId)).toMatchObject({ srId: 'sr-property', path: snapshot.path, body: snapshot.body, hash: snapshot.hash, origin: snapshot.origin, versionId: stored.versionId, versionNumber: 1 });
    } finally { db.close(); }
  }), { numRuns: 150, seed });
});

test('PBT-03 versions stay contiguous newest-first and duplicate latest snapshots are no-ops', () => {
  fc.assert(fc.property(worktreeVersionBodiesArbitrary, bodies => {
    const db = database();
    try {
      const history = new SQLiteWorktreeDocumentHistory(db); const path = 'aidlc-docs/property/sequence.md';
      const stored = bodies.map((body, index) => history.recordSnapshot({ srId: 'sr-property', path, body, hash: createHash('sha256').update(body).digest('hex'), origin: index % 2 ? 'human_edit' : 'ai_generated', change: index ? 'modified' : 'created' }));
      const latest = stored.at(-1)!;
      const duplicate = history.recordSnapshot({ srId: 'sr-property', path, body: latest.body, hash: latest.hash, origin: 'ai_generated', change: 'unchanged' });
      expect(duplicate.versionId).toBe(latest.versionId);
      expect(history.listVersions('sr-property', path).map(item => item.versionNumber)).toEqual(Array.from({ length: bodies.length }, (_, index) => bodies.length - index));
      expect(history.listDocuments('sr-property')).toMatchObject([{ path, versionId: latest.versionId, versionNumber: bodies.length, hash: latest.hash }]);
    } finally { db.close(); }
  }), { numRuns: 150, seed });
});
