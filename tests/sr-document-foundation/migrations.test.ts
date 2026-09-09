import { expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testDB } from './helpers/test-db.js';
import { openDatabase } from '../../src/sr-document-foundation/storage/database.js';
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
