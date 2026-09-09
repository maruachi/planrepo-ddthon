import { expect, test } from 'vitest';
import { ApiClient } from '../../../src/shared/client/api-client.js';
import { answersComplete, isRun, isWorkflow, PlanningMutation } from '../../../src/aidlc-planning/ui/planning-client.js';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const workflow = { srId: 's', revision: 2, stageIndex: 0, column: 'requirements_analysis', status: 'awaiting_approval', inceptionCycle: 0, constructionCycle: 0, reviewTargets: [{ srId: 's', documentId: 'd', versionId: 'v' }], stage: 'requirements-analysis', stageLabel: '요구사항 분석', actions: ['revise'], canComplete: false };

test('lost response stays uncertain until explicit query and cannot submit again', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const tracker = new PlanningMutation('s', () => {}, new ApiClient(async (path, init) => { calls.push({ path: String(path), init }); if (init?.method === 'POST') throw new Error('lost'); return response({ ok: true, data: { status: 'in_progress' } }); }));
  await tracker.submit('answers', { questionSetId: 'q', answers: { a: 'keep draft' }, revision: 1 });
  expect(tracker.state.status).toBe('unknown'); expect(calls).toHaveLength(1);
  await tracker.submit('answers', {}); expect(calls).toHaveLength(1);
  await tracker.check(); expect(tracker.state.status).toBe('unknown'); expect(calls).toHaveLength(2);
  expect(calls.filter(c => c.init?.method === 'POST')).toHaveLength(1);
  expect(calls[0].init?.body).toContain('keep draft');
  expect((calls[0].init?.headers as Record<string, string>)['X-Operation-Id']).toMatch(/^[a-f0-9-]{36}$/);
});

test('explicit committed receipt resolves workflow without replay', async () => {
  let calls = 0;
  const tracker = new PlanningMutation('s', () => {}, new ApiClient(async () => { calls++; return calls === 1 ? response({ ok: true, data: {} }) : calls === 2 ? response({ ok: true, data: { status: 'committed', receipt: { srId: 's', kind: 'planning_decide' } } }) : response({ ok: true, data: workflow }); }));
  await tracker.submit('decisions', { kind: 'approve' }); expect(tracker.state.status).toBe('unknown');
  await tracker.check(); expect(tracker.state).toMatchObject({ status: 'succeeded', data: workflow }); expect(calls).toBe(3);
});

test('receipt for another SR never resolves the current draft', async () => {
  let calls = 0;
  const tracker = new PlanningMutation('s', () => {}, new ApiClient(async () => { calls++; if (calls === 1) throw new Error('lost'); return response({ ok: true, data: { status: 'committed', receipt: { srId: 'another', kind: 'planning_answer' } } }); }));
  await tracker.submit('answers', {}); await tracker.check(); expect(tracker.state.status).toBe('unknown'); expect(calls).toBe(2);
});

test('advance receipt resolves the exact original run rather than a newer workflow', async () => {
  const paths: string[] = [];
  const originalRun = { id: 'original-run', srId: 's', stage: 'requirements-analysis', status: 'failed', startedAt: 'now', outputRefs: [], error: { code: 'RUN_FAILED', message: 'original failure' } };
  const tracker = new PlanningMutation('s', () => {}, new ApiClient(async path => {
    paths.push(String(path));
    if (paths.length === 1) throw new Error('lost');
    return response({ ok: true, data: paths.length === 2 ? { status: 'committed', receipt: { srId: 's', kind: 'planning_advance', runId: 'original-run' } } : originalRun });
  }));
  await tracker.submit('advance', { action: 'generate' }); await tracker.check();
  expect(paths[2]).toBe('/api/srs/s/runs/original-run');
  expect(paths.some(p => p.endsWith('/workflow'))).toBe(false);
  expect(tracker.state).toMatchObject({ status: 'succeeded', data: originalRun });
});

test('new attempt requires acknowledgement and fresh workflow, resets without sending a POST', async () => {
  const requests: RequestInit[] = [];
  const tracker = new PlanningMutation('s', () => {}, new ApiClient(async (_path, init) => { requests.push(init ?? {}); if (init?.method === 'POST') throw new Error('lost'); return response({ ok: true, data: workflow }); }));
  await tracker.submit('answers', { answers: { q: 'keep' } }); const oldId = tracker.state.operationId;
  await tracker.prepareNewAttempt(false); expect(requests).toHaveLength(1); expect(tracker.state.status).toBe('unknown');
  expect(await tracker.prepareNewAttempt(true)).toEqual(workflow);
  expect(tracker.state.status).toBe('idle'); expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
  await tracker.submit('answers', { answers: { q: 'keep' }, revision: workflow.revision });
  expect(tracker.state.operationId).not.toBe(oldId);
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(2);
});

test('new attempt stays uncertain if refreshing workflow fails', async () => {
  const tracker = new PlanningMutation('s', () => {}, new ApiClient(async () => { throw new Error('offline'); }));
  await tracker.submit('advance', {}); const operationId = tracker.state.operationId;
  expect(await tracker.prepareNewAttempt(true)).toBeUndefined(); expect(tracker.state).toMatchObject({ status: 'unknown', operationId });
});

test('version conflict is a definite rejection, permitting deliberate resubmission', async () => {
  let calls = 0;
  const tracker = new PlanningMutation('s', () => {}, new ApiClient(async () => { calls++; return response({ ok: false, error: { code: 'VERSION_CONFLICT', message: '최신 상태를 확인해 주세요.' } }, 409); }));
  await tracker.submit('decisions', { comment: 'preserved' }); expect(tracker.state).toMatchObject({ status: 'rejected', error: { code: 'VERSION_CONFLICT' } });
  await tracker.submit('decisions', { comment: 'preserved', revision: 2 }); expect(calls).toBe(2);
});

test('guards reject invalid nested question and document data before rendering', () => {
  expect(isWorkflow(workflow)).toBe(true);
  expect(isWorkflow({ ...workflow, reviewTargets: [{ documentId: 'd' }] })).toBe(false);
  expect(isWorkflow({ ...workflow, questionSet: { id: 'q', runId: 'r', stage: 'requirements-analysis', questions: [{ id: 'a', prompt: 'Q', options: [42] }] } })).toBe(false);
  expect(isWorkflow({ ...workflow, latestRun: { id: 'r', status: 'running' } })).toBe(false);
  expect(isRun({ id: 'r', srId: 's', stage: 'requirements-analysis', status: 'succeeded', startedAt: 'now', outputRefs: [] })).toBe(true);
});

test('all question answers must contain non-whitespace text; unlisted answers do not count', () => {
  const questions = [{ id: 'a', prompt: 'one', options: [] }, { id: 'b', prompt: 'two', options: ['A', 'B'] }];
  expect(answersComplete(questions, { a: 'yes', c: 'extra' })).toBe(false);
  expect(answersComplete(questions, { a: 'yes', b: ' \n ' })).toBe(false);
  expect(answersComplete(questions, { a: 'yes', b: 'custom reply' })).toBe(true);
  expect(answersComplete([], {})).toBe(false);
});
