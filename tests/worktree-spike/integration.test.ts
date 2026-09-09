import express from 'express';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';
import { INITIAL_WORKFLOW_PROMPT_CLOSING, RESUME_PROMPT, buildInitialWorkflowPrompt, type AidlcStateParserPort, type GitWorktreePort, type ManifestPort, type ScopedManifest, type WorktreeAidlcRunnerPort, type WorktreeSrRequirements } from '../../src/worktree-spike/contracts.js';
import { WorktreeSpikeService } from '../../src/worktree-spike/worktree-spike-service.js';
import { worktreeSpikeRoutes } from '../../src/worktree-spike/http/worktree-spike-routes.js';
import { errorHandler } from '../../src/sr-document-foundation/http/error-handler.js';
import { GitWorktreeManager } from '../../src/worktree-spike/git/git-worktree.js';
import { LegacyAidlcStateParser } from '../../src/worktree-spike/state/legacy-aidlc-state-parser.js';
import { ScopedManifestService } from '../../src/worktree-spike/manifest/scoped-manifest.js';
import { WorktreeAidlcRunner, type WorktreeLauncherRequest } from '../../src/worktree-spike/runner/worktree-aidlc-runner.js';
import { SQLiteWorktreeDocumentHistory } from '../../src/worktree-spike/storage/sqlite-worktree-document-history.js';
import { SQLiteWorktreeSpikePersistence } from '../../src/worktree-spike/storage/sqlite-worktree-spike-persistence.js';
import { WorktreeDocumentWriter } from '../../src/worktree-spike/files/worktree-document-writer.js';
import { unwrap } from '../../src/shared/errors.js';
import { srFixture } from '../sr-document-foundation/helpers/fixtures.js';
import { testDB } from '../sr-document-foundation/helpers/test-db.js';

const srId = randomUUID();
const operationId = () => randomUUID();
const execute = promisify(execFile);
const srRequirements: WorktreeSrRequirements = { title: '결제 승인 SR', description: '승인 흐름을 구현합니다.', attachmentDisplayName: 'payment.md', attachmentMarkdown: '# 결제 명세\n승인 이력을 남깁니다.' };

function dependencies(repositoryRoot: string | undefined) {
  const git: GitWorktreePort = { provision: vi.fn(async (_repository, _workspace, id) => ({ srId: id, repositoryRoot: '/fixture/repository', branch: `planrepo/sr/${id}`, worktreeRoot: `/fixture/worktrees/${id}`, readiness: 'ready' as const })) };
  const state: AidlcStateParserPort = { parse: vi.fn(async root => ({ statePath: `${root}/aidlc-docs/aidlc-state.md`, currentStage: 'Code Generation', firstIncomplete: 'focused proof', status: 'parsed' as const })) };
  const manifests: ScopedManifest[] = [
    { entries: [{ path: 'AGENTS.md', hash: 'a'.repeat(64) }] },
    { entries: [{ path: 'AGENTS.md', hash: 'b'.repeat(64) }, { path: 'aidlc-docs/new.md', hash: 'c'.repeat(64) }] },
  ];
  const manifest: ManifestPort = {
    capture: vi.fn(async () => manifests.shift() ?? { entries: [] }),
    diff: vi.fn((before, after) => ({ before, after, created: ['aidlc-docs/new.md'], modified: ['AGENTS.md'], deleted: [] })),
  };
  const runner: WorktreeAidlcRunnerPort = { run: vi.fn(async () => ({ exitCode: 0, stdout: 'ok' })), close: vi.fn(async () => {}) };
  const requirements = { get: vi.fn(() => srRequirements) };
  return { repositoryRoot, workspaceRoot: '/fixture/worktrees', git, state, manifest, runner, requirements };
}

async function serverFor(service: WorktreeSpikeService) {
  const app = express(); app.use(express.json()); app.use('/api', worktreeSpikeRoutes(service)); app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected local address');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const post = (base: string, path: string, id = operationId(), body: Record<string, unknown> = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': id }, body: JSON.stringify(body) });

test('HTTP vertical slice provisions, starts from SR requirements, reports delta, and deduplicates one operation', async () => {
  const deps = dependencies('/fixture/repository'); const service = new WorktreeSpikeService(deps); const server = await serverFor(service);
  try {
    const provision = await post(server.base, `/api/srs/${srId}/worktree-spike/provision`);
    expect(provision.status).toBe(200);
    expect((await provision.json()).data).toMatchObject({ readiness: 'ready', currentStage: 'Code Generation', firstIncomplete: 'focused proof' });
    const op = operationId();
    const [first, replay] = await Promise.all([post(server.base, `/api/srs/${srId}/worktree-spike/resume`, op), post(server.base, `/api/srs/${srId}/worktree-spike/resume`, op)]);
    expect(first.status).toBe(202); expect(replay.status).toBe(202);
    expect((await first.json()).data).toMatchObject({
      runStatus: 'succeeded',
      changedPaths: ['AGENTS.md', 'aidlc-docs/new.md'],
      documents: [{ path: 'aidlc-docs/new.md', change: 'created', hash: 'c'.repeat(64) }],
    });
    expect(deps.runner.run).toHaveBeenCalledTimes(1);
    expect(deps.runner.run).toHaveBeenCalledWith(expect.objectContaining({ srId, worktreeRoot: `/fixture/worktrees/${srId}`, prompt: buildInitialWorkflowPrompt(srRequirements), operationId: op }));
  } finally { await service.close(); await server.close(); }
});

test('initial workflow prompt includes the optional attachment and omits its section when absent', () => {
  expect(buildInitialWorkflowPrompt(srRequirements)).toBe([
    '# SR 요구사항 명세서', '', '## 제목', srRequirements.title, '', '## 요구사항', srRequirements.description,
    '', '## 첨부 요구사항 명세서', srRequirements.attachmentDisplayName, '', srRequirements.attachmentMarkdown,
    '', INITIAL_WORKFLOW_PROMPT_CLOSING,
  ].join('\n'));
  const withoutAttachment = buildInitialWorkflowPrompt({ title: '간단 SR', description: '설명만 있습니다.' });
  expect(withoutAttachment).toContain('# SR 요구사항 명세서\n\n## 제목\n간단 SR\n\n## 요구사항\n설명만 있습니다.');
  expect(withoutAttachment).not.toContain('## 첨부 요구사항 명세서');
  expect(withoutAttachment.endsWith(INITIAL_WORKFLOW_PROMPT_CLOSING)).toBe(true);
});

test('does not launch Claude when first-run SR requirements cannot be loaded', async () => {
  const deps = dependencies('/fixture/repository');
  deps.requirements.get.mockImplementation(() => { throw new Error('SR missing'); });
  const service = new WorktreeSpikeService(deps);
  await service.provision(srId, operationId());
  await expect(service.resume(srId, operationId())).rejects.toThrow('SR missing');
  expect(deps.runner.run).not.toHaveBeenCalled();
  await service.close();
});

test('unconfigured HTTP view is read-only and provision returns a bounded domain error', async () => {
  const service = new WorktreeSpikeService(dependencies(undefined)); const server = await serverFor(service);
  try {
    const status = await fetch(`${server.base}/api/srs/${srId}/worktree-spike`);
    expect(status.status).toBe(200); expect((await status.json()).data).toMatchObject({ configured: false, readiness: 'absent', runStatus: 'idle' });
    const provision = await post(server.base, `/api/srs/${srId}/worktree-spike/provision`);
    expect(provision.status).toBe(409); expect((await provision.json()).error.code).toBe('PLANNING_ACTION_BLOCKED');
  } finally { await service.close(); await server.close(); }
});

test('interactive service keeps one Claude session, streams output, accepts a message, and finishes once', async () => {
  const deps = dependencies('/fixture/repository');
  let resolveCompletion!: (value: { exitCode: number; stdout: string }) => void;
  const completion = new Promise<{ exitCode: number; stdout: string }>(resolve => { resolveCompletion = resolve; });
  const send = vi.fn(async () => {}); const finish = vi.fn(() => resolveCompletion({ exitCode: 0, stdout: '' })); const cancel = vi.fn();
  let emit!: (event: { role: 'assistant' | 'status'; text: string; sessionId?: string; turnComplete?: boolean }) => void;
  const start = vi.fn((request, onEvent) => { emit = onEvent; return { sessionId: request.sessionId, completion, send, finish, cancel }; });
  const service = new WorktreeSpikeService({ ...deps, runner: { run: vi.fn(), start, close: vi.fn(async () => {}) } });
  await service.provision(srId, operationId());
  const started = await service.resume(srId, operationId());
  expect(started).toMatchObject({ runStatus: 'running', interactionStatus: 'running', sessionId: expect.any(String) });
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ prompt: buildInitialWorkflowPrompt(srRequirements), resume: false }), expect.any(Function));
  emit({ role: 'assistant', text: '진행할까요?', sessionId: started.sessionId });
  emit({ role: 'status', text: 'Claude 응답이 완료되었습니다.', sessionId: started.sessionId, turnComplete: true });
  expect(service.get(srId)).toMatchObject({ interactionStatus: 'awaiting_input', transcript: expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: '진행할까요?' })]) });
  await service.message(srId, operationId(), '진행해줘.');
  expect(send).toHaveBeenCalledWith('진행해줘.');
  expect(service.get(srId).transcript?.at(-1)).toMatchObject({ role: 'user', text: '진행해줘.' });
  await service.finish(srId, operationId());
  expect(finish).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(service.get(srId)).toMatchObject({ runStatus: 'succeeded', interactionStatus: 'succeeded' }));
  expect(start).toHaveBeenCalledTimes(1); await service.close();
});

test('a restarted service resumes the persisted Claude session with the exact state prompt', async () => {
  const deps = dependencies('/fixture/repository');
  const sessionId = '11111111-1111-4111-8111-111111111111';
  let resolveCompletion!: (value: { exitCode: number; stdout: string }) => void;
  const completion = new Promise<{ exitCode: number; stdout: string }>(resolve => { resolveCompletion = resolve; });
  const start = vi.fn(request => ({ sessionId: request.sessionId, completion, send: vi.fn(async () => {}), finish: vi.fn(), cancel: vi.fn() }));
  const persisted = {
    srId, configured: true, readiness: 'ready' as const, branch: `planrepo/sr/${srId}`, worktreeRoot: `/fixture/worktrees/${srId}`,
    runStatus: 'succeeded' as const, sessionId, interactionStatus: 'succeeded' as const, transcript: [], changedPaths: [], documents: [],
  };
  const service = new WorktreeSpikeService({ ...deps, runner: { run: vi.fn(), start, close: vi.fn(async () => {}) }, persistence: { load: () => persisted, save: vi.fn() } });
  const resumed = await service.resume(srId, operationId());
  expect(resumed).toMatchObject({ sessionId, runStatus: 'running', interactionStatus: 'running' });
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ prompt: RESUME_PROMPT, sessionId, resume: true }), expect.any(Function));
  expect(deps.requirements.get).not.toHaveBeenCalled();
  resolveCompletion({ exitCode: 0, stdout: '' });
  await vi.waitFor(() => expect(service.get(srId).runStatus).toBe('succeeded'));
  await service.close();
});

test('interactive HTTP routes validate, replay messages, expose transcript polling, finish, and cancel', async () => {
  const deps = dependencies('/fixture/repository');
  const handles: { resolve: (value: { exitCode: number; stdout: string }) => void; send: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
  let emit!: (event: { role: 'assistant' | 'status'; text: string; sessionId?: string; turnComplete?: boolean }) => void;
  const start = vi.fn((request, onEvent) => {
    emit = onEvent;
    let resolve!: (value: { exitCode: number; stdout: string }) => void;
    const completion = new Promise<{ exitCode: number; stdout: string }>(done => { resolve = done; });
    const send = vi.fn(async () => {});
    const finish = vi.fn(() => resolve({ exitCode: 0, stdout: '' }));
    const cancel = vi.fn(() => resolve({ exitCode: 143, stdout: '' }));
    handles.push({ resolve, send, finish, cancel });
    return { sessionId: request.sessionId, completion, send, finish, cancel };
  });
  const service = new WorktreeSpikeService({ ...deps, runner: { run: vi.fn(), start, close: vi.fn(async () => {}) } });
  const server = await serverFor(service);
  try {
    await post(server.base, `/api/srs/${srId}/worktree-spike/provision`);
    const resumed = await post(server.base, `/api/srs/${srId}/worktree-spike/resume`);
    expect(resumed.status).toBe(202);
    const running = (await resumed.json()).data;
    expect(running).toMatchObject({ interactionStatus: 'running', sessionId: expect.any(String) });
    emit({ role: 'assistant', text: '계속할까요?', sessionId: running.sessionId });
    emit({ role: 'status', text: 'Claude 응답이 완료되었습니다.', sessionId: running.sessionId, turnComplete: true });
    const status = await fetch(`${server.base}/api/srs/${srId}/worktree-spike`);
    expect((await status.json()).data).toMatchObject({ interactionStatus: 'awaiting_input', transcript: expect.arrayContaining([expect.objectContaining({ text: '계속할까요?' })]) });

    const messageOperation = operationId();
    const first = await post(server.base, `/api/srs/${srId}/worktree-spike/message`, messageOperation, { message: '진행해줘.' });
    const replay = await post(server.base, `/api/srs/${srId}/worktree-spike/message`, messageOperation, { message: '진행해줘.' });
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(handles[0].send).toHaveBeenCalledTimes(1);
    expect(handles[0].send).toHaveBeenCalledWith('진행해줘.');
    const whitespace = await post(server.base, `/api/srs/${srId}/worktree-spike/message`, operationId(), { message: '   ' });
    expect(whitespace.status).toBe(400); expect((await whitespace.json()).error.code).toBe('VALIDATION_ERROR');
    const oversized = await post(server.base, `/api/srs/${srId}/worktree-spike/message`, operationId(), { message: '가'.repeat(6000) });
    expect(oversized.status).toBe(413); expect((await oversized.json()).error.code).toBe('PAYLOAD_TOO_LARGE');

    const finished = await post(server.base, `/api/srs/${srId}/worktree-spike/finish`);
    expect(finished.status).toBe(200); expect(handles[0].finish).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(service.get(srId).interactionStatus).toBe('succeeded'));
    await post(server.base, `/api/srs/${srId}/worktree-spike/resume`);
    expect(start).toHaveBeenNthCalledWith(2, expect.objectContaining({ prompt: RESUME_PROMPT, sessionId: running.sessionId, resume: true }), expect.any(Function));
    const cancelled = await post(server.base, `/api/srs/${srId}/worktree-spike/cancel`);
    expect(cancelled.status).toBe(200); expect(handles[1].cancel).toHaveBeenCalledOnce();
    expect((await cancelled.json()).data).toMatchObject({ interactionStatus: 'cancelled', sessionId: running.sessionId });
  } finally { await service.close(); await server.close(); }
});

test('HTTP reads current and historical versions and idempotently saves a human edit', async () => {
  const fixture = testDB(); const sr = srFixture(); unwrap(fixture.store.commit(sr)); const id = sr.sr!.id;
  const worktreeRoot = join(fixture.dir, 'worktree'); const path = 'aidlc-docs/plan.md'; const body = '# AI v1\n';
  await mkdir(join(worktreeRoot, 'aidlc-docs'), { recursive: true }); await writeFile(join(worktreeRoot, path), body);
  const hash = createHash('sha256').update(body).digest('hex'); const history = new SQLiteWorktreeDocumentHistory(fixture.db);
  const first = history.recordSnapshot({ srId: id, path, body, hash, origin: 'ai_generated', change: 'created' });
  const { body: _body, isLatest: _latest, ...summary } = first;
  const persistence = new SQLiteWorktreeSpikePersistence(fixture.db);
  persistence.save({ srId: id, configured: true, readiness: 'ready', worktreeRoot, runStatus: 'succeeded', changedPaths: [path], documents: [summary] });
  const service = new WorktreeSpikeService({ repositoryRoot: fixture.dir, workspaceRoot: fixture.dir, git: { provision: vi.fn() }, state: { parse: vi.fn() }, manifest: new ScopedManifestService(), runner: { run: vi.fn(), close: vi.fn(async () => {}) }, persistence, history, writer: new WorktreeDocumentWriter() });
  const server = await serverFor(service); const endpoint = `/api/srs/${id}/worktree-spike/document`;
  try {
    const current = await fetch(`${server.base}${endpoint}?path=${encodeURIComponent(path)}`); expect(current.status).toBe(200); expect((await current.json()).data).toMatchObject({ versionNumber: 1, body });
    const op = operationId(); const request = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': op }, body: JSON.stringify({ path, expectedHash: hash, body: '# Human v2\n' }) };
    const saved = await fetch(`${server.base}${endpoint}/edits`, request); expect(saved.status).toBe(200); const savedData = (await saved.json()).data; expect(savedData).toMatchObject({ changed: true, view: { versionNumber: 2, origin: 'human_edit' } });
    const replay = await fetch(`${server.base}${endpoint}/edits`, request); expect((await replay.json()).data.view.versionId).toBe(savedData.view.versionId);
    const versions = await fetch(`${server.base}${endpoint}/versions?path=${encodeURIComponent(path)}`); expect((await versions.json()).data.items.map((item: { versionNumber: number }) => item.versionNumber)).toEqual([2, 1]);
    const historical = await fetch(`${server.base}${endpoint}?path=${encodeURIComponent(path)}&versionId=${first.versionId}`); expect((await historical.json()).data).toMatchObject({ body, isLatest: false });
    const conflict = await fetch(`${server.base}${endpoint}/edits`, { ...request, headers: { ...request.headers, 'X-Operation-Id': operationId() } }); expect(conflict.status).toBe(409); expect((await conflict.json()).error.code).toBe('VERSION_CONFLICT');
  } finally { await service.close(); await server.close(); fixture.close(); }
});

test('isolated Git vertical proof provisions, parses, runs in-place, and reports the scoped delta', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planrepo-spike-proof-'));
  const repositoryRoot = join(root, 'repository'); const workspaceRoot = join(root, 'worktrees');
  await mkdir(join(repositoryRoot, 'aidlc-docs'), { recursive: true });
  await execute('git', ['init', '-b', 'main'], { cwd: repositoryRoot });
  await execute('git', ['config', 'user.name', 'PlanRepo Spike'], { cwd: repositoryRoot });
  await execute('git', ['config', 'user.email', 'spike@example.invalid'], { cwd: repositoryRoot });
  await writeFile(join(repositoryRoot, 'AGENTS.md'), '# Test instructions\n');
  await writeFile(join(repositoryRoot, 'aidlc-docs', 'aidlc-state.md'), '# State\n- **Current Stage**: Code Generation\n- [x] Contract\n- [ ] Integrate vertical proof\n');
  await execute('git', ['add', '.'], { cwd: repositoryRoot });
  await execute('git', ['commit', '-m', 'fixture'], { cwd: repositoryRoot });

  let captured: WorktreeLauncherRequest | undefined;
  const runner = new WorktreeAidlcRunner({ launcher: request => {
    captured = request;
    const completion = writeFile(join(request.cwd, 'aidlc-docs', 'generated.md'), '# Generated by fake runner\n').then(() => ({ exitCode: 0, stdout: 'fake success' }));
    return { sessionId: request.sessionId, completion, send: vi.fn(async () => {}), finish: vi.fn(), cancel: vi.fn() };
  } });
  const isolatedRequirements = { title: '격리 SR', description: 'Worktree에서 requirements를 시작합니다.' };
  const service = new WorktreeSpikeService({ repositoryRoot, workspaceRoot, git: new GitWorktreeManager(), state: new LegacyAidlcStateParser(), manifest: new ScopedManifestService(), runner, requirements: { get: () => isolatedRequirements } });
  const isolatedSr = randomUUID();
  try {
    const provisioned = await service.provision(isolatedSr, operationId());
    expect(provisioned).toMatchObject({ readiness: 'ready', branch: `planrepo/sr/${isolatedSr}`, currentStage: 'Code Generation', firstIncomplete: 'Integrate vertical proof' });
    const resumed = await service.resume(isolatedSr, operationId());
    expect(resumed).toMatchObject({ runStatus: 'running', interactionStatus: 'running', sessionId: expect.any(String) });
    await vi.waitFor(() => expect(service.get(isolatedSr)).toMatchObject({ runStatus: 'succeeded', changedPaths: ['aidlc-docs/generated.md'], documents: expect.arrayContaining([expect.objectContaining({ path: 'aidlc-docs/generated.md', change: 'created' })]) }));
    await expect(service.document(isolatedSr, 'aidlc-docs/generated.md')).resolves.toMatchObject({ body: '# Generated by fake runner\n', change: 'created' });
    expect(captured).toMatchObject({ cwd: provisioned.worktreeRoot, input: buildInitialWorkflowPrompt(isolatedRequirements), shell: false });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
