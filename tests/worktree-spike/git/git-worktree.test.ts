import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorktreeManager } from '../../../src/worktree-spike/git/git-worktree.js';

const execute = promisify(execFile);
const cleanup: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

async function fixture(): Promise<{ root: string; repository: string; managedRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'planrepo-worktree-test-'));
  cleanup.push(root);
  const repository = join(root, 'repository');
  const managedRoot = join(root, 'managed');
  await mkdir(repository);
  await git(repository, ['init', '-b', 'main']);
  await git(repository, ['config', 'user.name', 'PlanRepo Test']);
  await git(repository, ['config', 'user.email', 'planrepo@example.invalid']);
  await writeFile(join(repository, 'README.md'), '# fixture\n', 'utf8');
  await git(repository, ['add', 'README.md']);
  await git(repository, ['commit', '-m', 'fixture']);
  return { root, repository, managedRoot };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('GitWorktreeManager', () => {
  it('provisions the deterministic branch/path and rediscovers it idempotently', async () => {
    const { repository, managedRoot } = await fixture();
    const first = await new GitWorktreeManager().provision(repository, managedRoot, 'SR-123');
    const second = await new GitWorktreeManager().provision(repository, managedRoot, 'SR-123');

    expect(first).toEqual(second);
    expect(first).toMatchObject({ srId: 'SR-123', branch: 'planrepo/sr/SR-123', readiness: 'ready' });
    expect(first.repositoryRoot).toBe(await realpath(repository));
    expect(first.worktreeRoot).toBe(await realpath(join(managedRoot, 'SR-123')));
    expect(await git(first.worktreeRoot, ['branch', '--show-current'])).toBe('planrepo/sr/SR-123');
  });

  it('isolates different SRs in different branches and worktree paths', async () => {
    const { repository, managedRoot } = await fixture();
    const manager = new GitWorktreeManager();
    const first = await manager.provision(repository, managedRoot, 'SR-A');
    const second = await manager.provision(repository, managedRoot, 'SR-B');

    expect(first.branch).not.toBe(second.branch);
    expect(first.worktreeRoot).not.toBe(second.worktreeRoot);
    expect(await git(first.worktreeRoot, ['branch', '--show-current'])).toBe(first.branch);
    expect(await git(second.worktreeRoot, ['branch', '--show-current'])).toBe(second.branch);
  });

  it('rejects unsafe SR IDs and paths that are not repository roots', async () => {
    const { repository, managedRoot } = await fixture();
    const manager = new GitWorktreeManager();
    await expect(manager.provision(repository, managedRoot, '../escape')).rejects.toThrow('SR ID');
    await mkdir(join(repository, 'nested'));
    await expect(manager.provision(join(repository, 'nested'), managedRoot, 'SR-safe')).rejects.toThrow('Git worktree root');
  });
});

