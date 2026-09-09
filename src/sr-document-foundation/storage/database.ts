import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { checkSupported, migrate } from './migrations.js';
export function openDatabase(path: string): Database.Database {
  if (existsSync(path)) {
    const probe = new Database(path, { readonly: true, fileMustExist: true });
    try { checkSupported(probe); if ((probe.pragma('foreign_key_check') as unknown[]).length) throw new Error('Invalid references'); } finally { probe.close(); }
  } else mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 100');
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('WAL unavailable');
    db.pragma('synchronous = FULL');
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || db.pragma('synchronous', { simple: true }) !== 2 || db.pragma('busy_timeout', { simple: true }) !== 100) throw new Error('DB configuration failed');
    migrate(db); return db;
  } catch (e) { db.close(); throw e; }
}
