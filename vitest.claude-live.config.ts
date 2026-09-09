import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
  test: {
    include: ['tests/live/claude-live.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 720_000,
    hookTimeout: 60_000,
  },
});
