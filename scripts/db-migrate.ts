import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openPlanRepoDatabase } from '@/src/persistence/database';
import { migrateDatabase } from '@/src/persistence/maintenance';
import { loadRuntimeConfig } from '@/src/runtime/config';

const config = loadRuntimeConfig(process.cwd(), process.env);
mkdirSync(config.paths.dataDir, { recursive: true });
const databasePath = join(config.paths.dataDir, 'planrepo.sqlite');
const db = openPlanRepoDatabase(databasePath);

try {
  migrateDatabase(db);
  console.log(`PlanRepo schema를 준비했습니다: ${databasePath}`);
} finally {
  db.close();
}
