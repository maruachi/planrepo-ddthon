import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('port를 예약하지 못했습니다.');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

test('Claude preflight가 실패해도 storage와 비AI HTTP를 기동하고 generation만 준비되지 않게 둡니다', async () => {
  const testRunId = randomUUID();
  const testRoot = resolve('.planrepo/test-runs', testRunId);
  const dataDir = join(testRoot, 'data');
  await mkdir(dataDir, { recursive: true });
  try {
    const port = await availablePort();
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/claude-startup.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: '/usr/bin:/bin',
          PLANREPO_MODE: 'test',
          PLANREPO_TEST_RUN_ID: testRunId,
          PLANREPO_PORT: String(port),
        },
        timeout: 30_000,
        maxBuffer: 8_192,
      },
    );
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      liveStatus: 200,
      live: { live: true },
      readyStatus: 200,
      ready: { ready: true, generationReady: false, code: 'READY' },
    });
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
