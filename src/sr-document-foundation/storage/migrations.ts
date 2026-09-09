import Database from 'better-sqlite3';
import { foundationSQL } from './migrations/001-foundation.js';
import { planningSQL } from './migrations/002-planning.js';
import { reviewSQL } from './migrations/003-reviews.js';
import { worktreeSpikeSQL } from './migrations/004-worktree-spike.js';
import { worktreeReviewSQL } from './migrations/005-worktree-reviews.js';
import { manualBoardColumnSQL } from './migrations/006-manual-board-column.js';
import { worktreeDocumentHistorySQL } from './migrations/007-worktree-document-history.js';
const schema = (db: Database.Database) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
export function checkSupported(db: Database.Database): number {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('DB integrity check failed');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version === 0) { if (schema(db).length) throw new Error('Unknown unversioned schema'); }
  else if (version >= 1 && version <= 7) {
    const expected = new Database(':memory:');
    try { expected.exec(foundationSQL); if (version >= 2) expected.exec(planningSQL); if (version >= 3) expected.exec(reviewSQL); if (version >= 4) expected.exec(worktreeSpikeSQL); if (version >= 5) expected.exec(worktreeReviewSQL); if (version >= 6) expected.exec(manualBoardColumnSQL); if (version >= 7) expected.exec(worktreeDocumentHistorySQL); if (JSON.stringify(schema(db)) !== JSON.stringify(schema(expected))) throw new Error('Unsupported schema structure'); }
    finally { expected.close(); }
  } else throw new Error('Unsupported schema version');
  return version;
}
export function migrate(db: Database.Database): void {
  db.transaction(() => {
    let version = checkSupported(db);
    if (version === 0) { db.exec(foundationSQL); db.pragma('user_version = 1'); version = 1; }
    if (version === 1) { db.exec(planningSQL); db.pragma('user_version = 2'); version = 2; }
    if (version === 2) { db.exec(reviewSQL); db.pragma('user_version = 3'); version = 3; }
    if (version === 3) { db.exec(worktreeSpikeSQL); db.pragma('user_version = 4'); version = 4; }
    if (version === 4) { db.exec(worktreeReviewSQL); db.pragma('user_version = 5'); version = 5; }
    if (version === 5) { db.exec(manualBoardColumnSQL); db.pragma('user_version = 6'); version = 6; }
    if (version === 6) { db.exec(worktreeDocumentHistorySQL); db.pragma('user_version = 7'); }
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Foreign key check failed');
  }).immediate();
}
