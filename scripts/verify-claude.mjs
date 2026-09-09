import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const testRunId = randomUUID();
const resultDir = resolve(root, '.planrepo/test-runs', testRunId, 'results');
const reportPath = resolve(resultDir, 'claude-verification.json');
const child = spawn(resolve(root, 'node_modules/.bin/vitest'), [
  'run', '--config', 'vitest.claude-live.config.ts',
], {
  cwd: root,
  shell: false,
  stdio: 'inherit',
  env: {
    ...process.env,
    PLANREPO_CLAUDE_TEST_RUN_ID: testRunId,
    PLANREPO_CLAUDE_REPORT_PATH: reportPath,
  },
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('close', (code, signal) => resolveExit(signal === null ? (code ?? 1) : 1));
});

if (exitCode !== 0) {
  try {
    await mkdir(resultDir, { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({
      schemaVersion: 1,
      testRunId,
      outcome: 'Failed',
      reason: 'LIVE_VERIFICATION_FAILED',
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
}

process.exitCode = exitCode;
