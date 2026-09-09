import { openPlanRepoDatabase } from '@/src/persistence/database';
import { migrateDatabase } from '@/src/persistence/maintenance';
import { startPlanRepo } from '@/src/main';

const testRunId = process.env.PLANREPO_TEST_RUN_ID;
if (testRunId === undefined) throw new Error('startup test run ID가 없습니다.');
const databasePath = `.planrepo/test-runs/${testRunId}/data/planrepo.sqlite`;
const db = openPlanRepoDatabase(databasePath);
migrateDatabase(db);
db.close();

const app = await startPlanRepo({ root: process.cwd(), development: true });
try {
  const live = await fetch(`${app.baseURL}/health/live`);
  const ready = await fetch(`${app.baseURL}/health/ready`);
  process.stdout.write(JSON.stringify({
    liveStatus: live.status,
    live: await live.json(),
    readyStatus: ready.status,
    ready: await ready.json(),
  }));
} finally {
  await app.close();
}
