import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { build } from 'vite';
import {
  createTestApp,
  type TestApp,
} from '@/tests/helpers/test-app';
import {
  readDemoManifest,
  type DemoManifest,
} from '@/tests/helpers/demo-manifest';

let webBuild: Promise<void> | undefined;

function ensureWebBuild(): Promise<void> {
  webBuild ??= build({
    configFile: resolve(import.meta.dirname, '../../../vite.config.ts'),
    logLevel: 'silent',
  }).then(() => undefined);
  return webBuild;
}

function testRunId(workerIndex: number, retry: number, testId: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ workerIndex, retry, testId }))
    .digest('hex')
    .slice(0, 24);
  return `cg08-${digest}`;
}

interface PlanRepoFixtures {
  readonly app: TestApp;
  readonly manifest: DemoManifest;
}

export const test = base.extend<PlanRepoFixtures>({
  app: async ({}, use, testInfo) => {
    await ensureWebBuild();
    const app = await createTestApp({
      fixture: 'DEMO-4',
      testRunId: testRunId(testInfo.workerIndex, testInfo.retry, testInfo.testId),
      serveWeb: true,
    });
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
  manifest: async ({ app }, use) => {
    await use(readDemoManifest(app.db));
  },
  baseURL: async ({ app }, use) => {
    await use(app.baseURL);
  },
});

export { expect };
