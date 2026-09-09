import Database from 'better-sqlite3';
import { foundationSQL } from './migrations/001-foundation.js';
import { planningSQL } from './migrations/002-planning.js';
import { reviewSQL } from './migrations/003-reviews.js';
const schema = (db: Database.Database) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
export function checkSupported(db: Database.Database): number {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('DB integrity check failed');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version === 0) { if (schema(db).length) throw new Error('Unknown unversioned schema'); }
  else if (version === 1 || version === 2 || version === 3) {
    const expected = new Database(':memory:');
    try { expected.exec(foundationSQL); if (version >= 2) expected.exec(planningSQL); if (version >= 3) expected.exec(reviewSQL); if (JSON.stringify(schema(db)) !== JSON.stringify(schema(expected))) throw new Error('Unsupported schema structure'); }
    finally { expected.close(); }
  } else throw new Error('Unsupported schema version');
  return version;
}
export function migrate(db: Database.Database): void {
  db.transaction(() => {
    let version = checkSupported(db);
    if (version === 0) { db.exec(foundationSQL); db.pragma('user_version = 1'); version = 1; }
    if (version === 1) { db.exec(planningSQL); db.pragma('user_version = 2'); version = 2; }
    if (version === 2) { db.exec(reviewSQL); db.pragma('user_version = 3'); }
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Foreign key check failed');
  }).immediate();
}
