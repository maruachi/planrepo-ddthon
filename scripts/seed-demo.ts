import { join } from 'node:path';
import { openPlanRepoDatabase } from '@/src/persistence/database';
import { seedDemo } from '@/src/persistence/seed-demo';
import { loadRuntimeConfig } from '@/src/runtime/config';

const config = loadRuntimeConfig(process.cwd(), process.env);
const databasePath = join(config.paths.dataDir, 'planrepo.sqlite');
const db = openPlanRepoDatabase(databasePath);

try {
  seedDemo(db);
  console.log(`DEMO-4 시드를 준비했습니다: ${databasePath}`);
} finally {
  db.close();
}
