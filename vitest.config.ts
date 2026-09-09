import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const projectRoot = resolve(import.meta.dirname);

export default defineConfig({
  resolve: { alias: { '@': projectRoot } },
  test: {
    environment: 'node',
    env: { PLANREPO_MODE: 'test' },
    include: [
      'tests/unit/**/*.test.ts',
      'tests/contract/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    exclude: [
      'tests/e2e/**',
      'tests/acceptance/**',
      'tests/live/**',
      'tests/performance/**',
      'tests/relocation/**',
    ],
  },
});
