import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openPlanRepoDatabase } from '@/src/persistence/database';
import { migrateDatabase } from '@/src/persistence/maintenance';

export interface TestDatabaseFixture {
  readonly db: Database.Database;
  readonly databasePath: string;
  close(): Promise<void>;
}

const TEST_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createTestDatabase(options: {
  readonly testRunId: string;
  readonly prepared?: boolean;
}): Promise<TestDatabaseFixture> {
  if (!TEST_RUN_ID.test(options.testRunId)) {
    throw new Error('testRunId는 UUID여야 합니다.');
  }

  const parentPath = join(tmpdir(), 'planrepo-storage-tests');
  const fixturePath = join(parentPath, options.testRunId);
  await mkdir(parentPath, { recursive: true });
  await mkdir(fixturePath);

  const databasePath = join(fixturePath, 'planrepo.sqlite');
  const db = openPlanRepoDatabase(databasePath);
  if (options.prepared !== false) migrateDatabase(db);

  return {
    db,
    databasePath,
    async close() {
      if (db.open) db.close();
      await rm(fixturePath, { recursive: true });
    },
  };
}
