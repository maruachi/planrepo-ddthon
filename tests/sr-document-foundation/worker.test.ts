import { expect, test } from 'vitest';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { DiffWorkerAdapter } from '../../src/sr-document-foundation/compare/diff-worker-adapter.js';
const workerPath = resolve('.dev/server/sr-document-foundation/compare/diff-worker.js');
const input = { left: { title: 'a', body: 'x\r\n' }, right: { title: 'a', body: 'y\n' } };
test('compiled worker runs, rejects simultaneous jobs and recovers from cancellation', async () => {
  const adapter = new DiffWorkerAdapter(workerPath); try {
    const a = adapter.compare(input); await expect(adapter.compare(input)).rejects.toMatchObject({ detail: { code: 'COMPARE_BUSY' } }); expect((await a).blocks.length).toBeGreaterThan(0);
    const abort = new AbortController(); const cancelled = adapter.compare(input, abort.signal); abort.abort(); await expect(cancelled).rejects.toMatchObject({ detail: { code: 'COMPARE_FAILED' } });
    expect((await adapter.compare(input)).unchanged).toBe(false);
  } finally { await adapter.close(); }
});
test('hung and crashed worker return explicit failures; next request can recover', async () => {
  let first = true;
  const adapter = new DiffWorkerAdapter(workerPath, 500, path => { if (first) { first = false; return new Worker('setInterval(() => {},1000)', { eval: true }); } return new Worker(path); });
  try { await expect(adapter.compare(input)).rejects.toMatchObject({ detail: { code: 'COMPARE_FAILED' } }); expect((await adapter.compare(input)).blocks.length).toBeGreaterThan(0); } finally { await adapter.close(); }
  const crashed = new DiffWorkerAdapter(workerPath, 1000, () => new Worker('throw new Error("fixture")', { eval: true }));
  try { await expect(crashed.compare(input)).rejects.toMatchObject({ detail: { code: 'COMPARE_FAILED' } }); } finally { await crashed.close(); }
});
