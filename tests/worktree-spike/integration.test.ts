import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';
import { RESUME_PROMPT, type AidlcStateParserPort, type GitWorktreePort, type ManifestPort, type ScopedManifest, type WorktreeAidlcRunnerPort } from '../../src/worktree-spike/contracts.js';
import { WorktreeSpikeService } from '../../src/worktree-spike/worktree-spike-service.js';
import { worktreeSpikeRoutes } from '../../src/worktree-spike/http/worktree-spike-routes.js';
import { errorHandler } from '../../src/sr-document-foundation/http/error-handler.js';
import { GitWorktreeManager } from '../../src/worktree-spike/git/git-worktree.js';
import { LegacyAidlcStateParser } from '../../src/worktree-spike/state/legacy-aidlc-state-parser.js';
import { ScopedManifestService } from '../../src/worktree-spike/manifest/scoped-manifest.js';
import { WorktreeAidlcRunner, type WorktreeLauncherRequest } from '../../src/worktree-spike/runner/worktree-aidlc-runner.js';

const srId = randomUUID();
const operationId = () => randomUUID();
const execute = promisify(execFile);

function dependencies(repositoryRoot: string | undefined) {
  const git: GitWorktreePort = { provision: vi.fn(async (_repository, _workspace, id) => ({ srId: id, repositoryRoot: '/fixture/repository', branch: `planrepo/sr/${id}`, worktreeRoot: `/fixture/worktrees/${id}`, readiness: 'ready' as const })) };
  const state: AidlcStateParserPort = { parse: vi.fn(async root => ({ statePath: `${root}/aidlc-docs/aidlc-state.md`, currentStage: 'Code Generation', firstIncomplete: 'focused proof', status: 'parsed' as const })) };
  const manifests: ScopedManifest[] = [
    { entries: [{ path: 'AGENTS.md', hash: 'before' }] },
    { entries: [{ path: 'AGENTS.md', hash: 'after' }, { path: 'aidlc-docs/new.md', hash: 'created' }] },
  ];
  const manifest: ManifestPort = {
    capture: vi.fn(async () => manifests.shift() ?? { entries: [] }),
    diff: vi.fn((before, after) => ({ before, after, created: ['aidlc-docs/new.md'], modified: ['AGENTS.md'], deleted: [] })),
  };
  const runner: WorktreeAidlcRunnerPort = { run: vi.fn(async () => ({ exitCode: 0, stdout: 'ok' })), close: vi.fn(async () => {}) };
  return { repositoryRoot, workspaceRoot: '/fixture/worktrees', git, state, manifest, runner };
}

async function serverFor(service: WorktreeSpikeService) {
  const app = express(); app.use(express.json()); app.use('/api', worktreeSpikeRoutes(service)); app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected local address');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const post = (base: string, path: string, id = operationId()) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': id }, body: '{}' });

test('HTTP vertical slice provisions, resumes, reports delta, and deduplicates one operation', async () => {
  const deps = dependencies('/fixture/repository'); const service = new WorktreeSpikeService(deps); const server = await serverFor(service);
  try {
    const provision = await post(server.base, `/api/srs/${srId}/worktree-spike/provision`);
    expect(provision.status).toBe(200);
    expect((await provision.json()).data).toMatchObject({ readiness: 'ready', currentStage: 'Code Generation', firstIncomplete: 'focused proof' });
    const op = operationId();
    const [first, replay] = await Promise.all([post(server.base, `/api/srs/${srId}/worktree-spike/resume`, op), post(server.base, `/api/srs/${srId}/worktree-spike/resume`, op)]);
    expect(first.status).toBe(202); expect(replay.status).toBe(202);
    expect((await first.json()).data).toMatchObject({ runStatus: 'succeeded', changedPaths: ['AGENTS.md', 'aidlc-docs/new.md'] });
    expect(deps.runner.run).toHaveBeenCalledTimes(1);
    expect(deps.runner.run).toHaveBeenCalledWith(expect.objectContaining({ srId, worktreeRoot: `/fixture/worktrees/${srId}`, prompt: RESUME_PROMPT, operationId: op }));
  } finally { await service.close(); await server.close(); }
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
  const runner = new WorktreeAidlcRunner({ launcher: async request => {
    captured = request;
    await writeFile(join(request.cwd, 'aidlc-docs', 'generated.md'), '# Generated by fake runner\n');
    return { exitCode: 0, stdout: 'fake success' };
  } });
  const service = new WorktreeSpikeService({ repositoryRoot, workspaceRoot, git: new GitWorktreeManager(), state: new LegacyAidlcStateParser(), manifest: new ScopedManifestService(), runner });
  const isolatedSr = randomUUID();
  try {
    const provisioned = await service.provision(isolatedSr, operationId());
    expect(provisioned).toMatchObject({ readiness: 'ready', branch: `planrepo/sr/${isolatedSr}`, currentStage: 'Code Generation', firstIncomplete: 'Integrate vertical proof' });
    const resumed = await service.resume(isolatedSr, operationId());
    expect(resumed).toMatchObject({ runStatus: 'succeeded', changedPaths: ['aidlc-docs/generated.md'] });
    expect(captured).toMatchObject({ cwd: provisioned.worktreeRoot, input: RESUME_PROMPT, shell: false });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
