import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../src/sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../../../src/sr-document-foundation/storage/sqlite-store.js';
export function testDB() {
  const dir = mkdtempSync(join(tmpdir(), 'planrepo-test-')); const path = join(dir, 'test.sqlite');
  const db = openDatabase(path); const store = new SQLiteStore(db);
  return { dir, path, db, store, close: () => { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

import { SRService } from '../../../src/sr-document-foundation/services/sr-service.js';
import { DocumentService } from '../../../src/sr-document-foundation/services/document-service.js';
import { compareLines } from '../../../src/sr-document-foundation/compare/line-diff.js';
const diff = { compare: async (input: Parameters<typeof compareLines>[0]) => compareLines(input), close: async () => {} };
export function services() { const t = testDB(); const sr = new SRService(t.store); const docs = new DocumentService(t.store, diff); return { ...t, sr, docs }; }
