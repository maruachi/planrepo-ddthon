import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { createServer as createViteServer } from 'vite';
import { createAppLifecycle } from '@/src/application/app-lifecycle';
import { createHttpServer } from '@/src/application/http/server';
import { openPlanRepoDatabase } from '@/src/persistence/database';
import { runOfflineMaintenance } from '@/src/persistence/maintenance';
import { createTestApp } from '@/tests/helpers/test-app';
import { createTestDatabase } from '@/tests/helpers/test-database';
import { readDemoManifest } from '@/tests/helpers/demo-manifest';

test('DEMO-4 TestApp은 실제 listener와 검증된 seed를 쓰고 generation은 paused다', async () => {
  const app = await createTestApp({
    fixture: 'DEMO-4',
    testRunId: randomUUID(),
  });
  try {
    const live = await fetch(`${app.baseURL}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ live: true });
    expect(readDemoManifest(app.db)).toMatchObject({
      seedId: 'DEMO-4',
      projectId: 'demo-project',
      defaultActorId: 'persona-p01-owner',
    });
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM srs').get()).toEqual({
      count: 4,
    });
    const ready = await app.server.inject({
      method: 'GET',
      url: '/health/ready',
      headers: { host: new URL(app.baseURL).host },
    });
    expect(ready.json()).toMatchObject({
      ready: true,
      generationReady: false,
    });
  } finally {
    await app.close();
  }
});

test('지원 schema가 없는 DB는 ready 503으로 남는다', async () => {
  const fixture = await createTestDatabase({
    testRunId: randomUUID(),
    prepared: false,
  });
  const lifecycle = createAppLifecycle(fixture.db, {
    runtimeId: randomUUID(),
    hostId: 'unknown:test-host',
    bootId: 'unknown:test-boot',
    parentPid: process.pid,
    parentStartedAt: 'unavailable',
    registeredAt: '2026-09-09T00:00:00.000Z',
  });
  await lifecycle.start();
  const server = createHttpServer({
    lifecycle,
    handlers: {},
    expectedHost: '127.0.0.1:4173',
    allowedOrigin: 'http://127.0.0.1:4173',
  });
  try {
    const response = await server.inject({
      method: 'GET',
      url: '/health/ready',
      headers: { host: '127.0.0.1:4173' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ready: false,
      generationReady: false,
      code: 'STORE_UNAVAILABLE',
    });

    const method = await server.inject({
      method: 'POST',
      url: '/api/methods/M-001',
      headers: {
        host: '127.0.0.1:4173',
        origin: 'http://127.0.0.1:4173',
        'x-planrepo-actor': 'persona-p01-owner',
      },
      payload: {
        scope: { kind: 'project', projectId: 'demo-project' },
        input: {},
      },
    });
    expect(method.statusCode).toBe(503);
    expect(method.json()).toMatchObject({ code: 'STORE_UNAVAILABLE' });
  } finally {
    await server.close();
    await lifecycle.close();
    await fixture.close();
  }
});

test('등록된 runtime은 offline maintenance를 막고 close에서 활성 등록만 해제한다', async () => {
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
  });
  try {
    expect(() =>
      runOfflineMaintenance(app.db, 'maintenance-race', () => undefined),
    ).toThrow('runtime이 등록된 DB에서는 offline maintenance를 시작할 수 없습니다.');
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM runtime_instances').get(),
    ).toEqual({ count: 1 });
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM runtime_identities').get(),
    ).toEqual({ count: 1 });
  } finally {
    await app.close();
  }
});

test('runtime 등록 실패 cleanup은 다른 connection의 활성 등록과 identity를 보존한다', async () => {
  const fixture = await createTestDatabase({ testRunId: randomUUID() });
  const secondDb = openPlanRepoDatabase(fixture.databasePath);
  const observerDb = openPlanRepoDatabase(fixture.databasePath);
  const registration = {
    runtimeId: randomUUID(),
    hostId: 'unknown:first-host',
    bootId: 'unknown:first-boot',
    parentPid: process.pid,
    parentStartedAt: 'unavailable',
    registeredAt: '2026-09-09T00:00:00.000Z',
  };
  const first = createAppLifecycle(fixture.db, registration);
  const duplicate = createAppLifecycle(secondDb, registration);
  try {
    await first.start();
    await duplicate.start();
    expect(first.readiness().storageReady).toBe(true);
    expect(duplicate.readiness()).toMatchObject({
      storageReady: false,
      publicCode: 'STORE_UNAVAILABLE',
    });
    expect(observerDb.prepare('SELECT COUNT(*) AS count FROM runtime_instances').get()).toEqual({ count: 1 });

    await duplicate.close();
    expect(observerDb.prepare('SELECT COUNT(*) AS count FROM runtime_instances').get()).toEqual({ count: 1 });

    await first.close();
    expect(observerDb.prepare('SELECT COUNT(*) AS count FROM runtime_instances').get()).toEqual({ count: 0 });
    expect(observerDb.prepare('SELECT COUNT(*) AS count FROM runtime_identities').get()).toEqual({ count: 1 });
  } finally {
    await duplicate.close();
    await first.close();
    if (observerDb.open) observerDb.close();
    await fixture.close();
  }
});

test('runtime unregister가 SQLITE_BUSY여도 connection을 닫고 활성 등록을 성공으로 표시하지 않는다', async () => {
  const fixture = await createTestDatabase({ testRunId: randomUUID() });
  const lockDb = openPlanRepoDatabase(fixture.databasePath);
  const registration = {
    runtimeId: randomUUID(),
    hostId: 'unknown:busy-host',
    bootId: 'unknown:busy-boot',
    parentPid: process.pid,
    parentStartedAt: 'unavailable',
    registeredAt: '2026-09-09T00:00:00.000Z',
  };
  const lifecycle = createAppLifecycle(fixture.db, registration);
  try {
    await lifecycle.start();
    lockDb.exec('BEGIN IMMEDIATE');
    await expect(lifecycle.close()).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
    expect(fixture.db.open).toBe(false);
    expect(lockDb.prepare('SELECT COUNT(*) AS count FROM runtime_instances WHERE runtime_id=?').get(registration.runtimeId)).toEqual({ count: 1 });
    await expect(lifecycle.close()).rejects.toThrow('runtime 활성 등록 해제를 완료하지 못했습니다.');
  } finally {
    if (lockDb.inTransaction) lockDb.exec('ROLLBACK');
    if (lockDb.open) lockDb.close();
    if (fixture.db.open) fixture.db.close();
    await fixture.close();
  }
});

test('start-dev는 자식의 비정상 종료 code를 부모 exit code로 전파한다', async () => {
  const projectRoot = resolve(import.meta.dirname, '../..');
  const tsxCli = resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs');
  const result = await new Promise<{ readonly code: number | null; readonly output: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [tsxCli, 'scripts/start-dev.ts'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PLANREPO_MODE: 'test',
        PLANREPO_TEST_RUN_ID: '',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code) => resolveResult({ code, output }));
  });
  expect(result.output).toContain('PLANREPO_TEST_RUN_ID');
  expect(result.code).toBe(1);
});

test('Vite client 변환은 VITE_ 환경 sentinel을 import.meta.env에 노출하지 않는다', async () => {
  const projectRoot = resolve(import.meta.dirname, '../..');
  const probeName = `cg05-env-${randomUUID()}.ts`;
  const probePath = resolve(projectRoot, 'src/web', probeName);
  const sentinel = `private-${randomUUID()}`;
  const previous = process.env.VITE_PRIVATE_TOKEN;
  const previousMode = process.env.PLANREPO_MODE;
  const previousTestRunId = process.env.PLANREPO_TEST_RUN_ID;
  process.env.VITE_PRIVATE_TOKEN = sentinel;
  process.env.PLANREPO_MODE = 'test';
  process.env.PLANREPO_TEST_RUN_ID = randomUUID();
  await writeFile(probePath, 'export default import.meta.env;', 'utf8');
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    vite = await createViteServer({
      configFile: resolve(projectRoot, 'vite.config.ts'),
      server: { middlewareMode: true },
    });
    const transformed = await vite.transformRequest(`/${probeName}`);
    expect(transformed?.code).not.toContain('VITE_PRIVATE_TOKEN');
    expect(transformed?.code).not.toContain(sentinel);
  } finally {
    if (vite !== undefined) await vite.close();
    await rm(probePath, { force: true });
    if (previous === undefined) delete process.env.VITE_PRIVATE_TOKEN;
    else process.env.VITE_PRIVATE_TOKEN = previous;
    if (previousMode === undefined) delete process.env.PLANREPO_MODE;
    else process.env.PLANREPO_MODE = previousMode;
    if (previousTestRunId === undefined) delete process.env.PLANREPO_TEST_RUN_ID;
    else process.env.PLANREPO_TEST_RUN_ID = previousTestRunId;
  }
});
