import { chmod, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClaudePlanRunner, parseRunnerOutput } from '../../../src/aidlc-planning/cli/claude-plan-runner.js';
import type { ContextSnapshot } from '../../../src/shared/planning-contracts.js';

const executable = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const context = (title = 'success'): ContextSnapshot => ({
  sr: { id: 'sr', title, description: '요구 사항', column: 'sr_list', createdAt: '', actor: { source: 'user' } }, runId: 'run', stage: 'requirements-analysis',
  workflow: { srId: 'sr', revision: 0, stageIndex: 0, column: 'sr_list', status: 'running', inceptionCycle: 0, constructionCycle: 0, reviewTargets: [] },
  documents: [], history: [], rules: 'Generate requirements.', scope: 'planning-only', finalize: false,
});
const valid = { artifacts: [{ logicalKey: 'plan', title: 'Plan', body: 'Details' }], questions: [], summary: 'Ready' };
beforeAll(async () => { await chmod(executable, 0o700); });
describe('CLI validation', () => {
  it('accepts structured and JSON-string result envelopes and questions-only output', () => {
    for (const value of [valid, { structured_output: valid }, { result: JSON.stringify(valid) }, { artifacts: [], questions: [{ id: 'q1', prompt: 'Which?', options: [] }], summary: 'Clarify' }]) expect(parseRunnerOutput(JSON.stringify(value)).ok).toBe(true);
  });
  it('rejects malformed, empty, duplicate, unknown-field and oversized content', () => {
    const question = { id: 'q', prompt: 'Choose', options: [] };
    for (const value of [null, {}, { ...valid, artifacts: [] }, { ...valid, artifacts: [valid.artifacts[0], valid.artifacts[0]] }, { ...valid, questions: [question, question] }, { ...valid, questions: [{ ...question, options: ['same', 'same'] }] }, { ...valid, artifacts: [{ ...valid.artifacts[0], body: 'x'.repeat(1048577) }] }, { ...valid, artifacts: [{ ...valid.artifacts[0], body: ' ' }] }, { ...valid, unexpected: true }, { is_error: true, structured_output: valid }, { subtype: 'error_max_turns', result: JSON.stringify(valid) }]) expect(parseRunnerOutput(JSON.stringify(value)).ok).toBe(false);
    expect(parseRunnerOutput('not JSON').ok).toBe(false);
  });
});
describe('CLI process ownership', () => {
  it('sends input via stdin with restricted flags and removes its unique cwd', async () => {
    const runner = new ClaudePlanRunner({ executable });
    const result = await runner.execute(context(), {});
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.data.artifacts[0].body).toBe('요구 사항'); expect(result.data.summary).toContain('planrepo-planning-'); await expect(access(result.data.summary)).rejects.toThrow(); }
    await runner.close();
  });
  it('bounds output and distinguishes exit failure without disclosing stderr', async () => {
    const runner = new ClaudePlanRunner({ executable, outputBytes: 1024 });
    expect(await runner.execute(context('overflow'), {})).toMatchObject({ ok: false, error: { code: 'CLI_OUTPUT_TOO_LARGE' } });
    const result = await runner.execute(context('fail'), {});
    expect(result).toMatchObject({ ok: false, error: { code: 'CLI_FAILED' } }); expect(JSON.stringify(result)).not.toContain('SECRET');
    await runner.close();
  });
  it('kills timeout even when SIGTERM is ignored', async () => {
    const runner = new ClaudePlanRunner({ executable, timeoutMs: 100 });
    expect(await runner.execute(context('hang'), {})).toMatchObject({ ok: false, error: { code: 'CLI_TIMEOUT' } }); await runner.close();
  });
  it('honors already-aborted requests and close aborts all work including setup', async () => {
    const runner = new ClaudePlanRunner({ executable }); const controller = new AbortController(); controller.abort();
    expect(await runner.execute(context(), { signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'CLI_CANCELLED' } });
    const pending = [runner.execute(context('hang'), {}), runner.execute(context('hang'), {})];
    await runner.close();
    for (const result of await Promise.all(pending)) expect(result).toMatchObject({ ok: false, error: { code: 'CLI_CANCELLED' } });
    expect(await runner.execute(context(), {})).toMatchObject({ ok: false, error: { code: 'CLI_CANCELLED' } });
  });
  it('reports unavailable executables', async () => {
    const runner = new ClaudePlanRunner({ executable: '/nonexistent/planrepo-claude' });
    expect(await runner.execute(context(), {})).toMatchObject({ ok: false, error: { code: 'CLI_UNAVAILABLE' } }); await runner.close();
  });
  it('aborts a running child and close waits for process cleanup', async () => {
    const runner = new ClaudePlanRunner({ executable }); const controller = new AbortController();
    const running = runner.execute(context('hang'), { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 100)); controller.abort();
    await runner.close();
    expect(await running).toMatchObject({ ok: false, error: { code: 'CLI_CANCELLED' } });
  });
});
