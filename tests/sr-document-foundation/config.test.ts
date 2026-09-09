import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { loadConfig } from '../../src/app/config.js';
test('development and build paths resolve against module application root', () => {
  const root = resolve('.'); const dev = loadConfig({}, resolve('src/app/config.ts')); const built = loadConfig({}, resolve('dist/server/app/config.js'));
  expect(dev.dbPath).toBe(resolve('.planrepo/planrepo.sqlite')); expect(built.dbPath).toBe(dev.dbPath);
  expect(dev.workerPath).toBe(root + '/.dev/server/sr-document-foundation/compare/diff-worker.js'); expect(built.workerPath).toBe(root + '/dist/server/sr-document-foundation/compare/diff-worker.js');
  expect(loadConfig({ PLANREPO_DB_PATH: 'data/test.sqlite' }).dbPath).toBe(resolve('data/test.sqlite'));
  expect(loadConfig({ PLANREPO_DB_PATH: '/tmp/custom.sqlite' }).dbPath).toBe('/tmp/custom.sqlite');
  for (const port of ['0', '-1', '65536', '4310.5', '', ' 4310']) expect(() => loadConfig({ PLANREPO_PORT: port })).toThrow();
});
