import { spawn } from 'node:child_process';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { GitWorktreePort, WorktreeHandle } from '../contracts.js';
import { assertGitCommandAllowed } from './git-command-policy.js';

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface WorktreeRecord {
  path: string;
  branch?: string;
}

const SR_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OUTPUT_LIMIT = 1024 * 1024;

function within(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(pathFromRoot);
}

function parseWorktreeList(raw: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | undefined;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) records.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === '' && current) {
      records.push(current);
      current = undefined;
    }
  }
  if (current) records.push(current);
  return records;
}

async function runGit(cwd: string, args: readonly string[], acceptedCodes: readonly number[] = [0]): Promise<GitResult> {
  assertGitCommandAllowed(args);
  const result = await new Promise<GitResult>((resolveResult, reject) => {
    const child = spawn('git', [...args], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(error);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > OUTPUT_LIMIT) fail(new Error('Git stdout exceeded the allowed size.'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > OUTPUT_LIMIT) fail(new Error('Git stderr exceeded the allowed size.'));
      else stderr.push(chunk);
    });
    child.on('error', fail);
    child.on('close', code => {
      if (settled) return;
      settled = true;
      resolveResult({ code: code ?? -1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
  if (!acceptedCodes.includes(result.code)) {
    const detail = result.stderr.trim();
    throw new Error(detail ? `Git command failed: ${detail}` : `Git command failed with exit code ${result.code}.`);
  }
  return result;
}

async function canonicalDirectory(path: string, label: string): Promise<string> {
  const canonical = await realpath(path).catch(() => { throw new Error(`${label} does not exist.`); });
  const details = await stat(canonical);
  if (!details.isDirectory()) throw new Error(`${label} must be a directory.`);
  return canonical;
}

export class GitWorktreeManager implements GitWorktreePort {
  async provision(repositoryRoot: string, workspaceRoot: string, srId: string): Promise<WorktreeHandle> {
    if (!SR_ID.test(srId)) throw new Error('SR ID is not safe for a Git branch or worktree path.');

    const repository = await canonicalDirectory(repositoryRoot, 'Repository root');
    const detectedRoot = (await runGit(repository, ['rev-parse', '--show-toplevel'])).stdout.trim();
    const canonicalDetectedRoot = await canonicalDirectory(detectedRoot, 'Git repository root');
    if (canonicalDetectedRoot !== repository) throw new Error('Repository path must identify the Git worktree root.');

    await mkdir(workspaceRoot, { recursive: true });
    const managedRoot = await canonicalDirectory(workspaceRoot, 'Managed workspace root');
    const branch = `planrepo/sr/${srId}`;
    const expectedPath = resolve(managedRoot, srId);
    if (!within(managedRoot, expectedPath) || expectedPath === managedRoot) throw new Error('Worktree path escapes the managed workspace root.');

    const existing = await this.findExisting(repository, branch);
    if (existing) return await this.rediscover(existing, repository, managedRoot, expectedPath, srId, branch);

    const branchRef = `refs/heads/${branch}`;
    const branchResult = await runGit(repository, ['show-ref', '--verify', '--quiet', branchRef], [0, 1]);
    if (branchResult.code === 0) await runGit(repository, ['worktree', 'add', expectedPath, branch]);
    else await runGit(repository, ['worktree', 'add', '-b', branch, expectedPath, 'HEAD']);

    const created = await this.findExisting(repository, branch);
    if (!created) throw new Error('Git did not register the provisioned worktree.');
    return await this.rediscover(created, repository, managedRoot, expectedPath, srId, branch);
  }

  private async findExisting(repository: string, branch: string): Promise<WorktreeRecord | undefined> {
    const list = await runGit(repository, ['worktree', 'list', '--porcelain']);
    const matches = parseWorktreeList(list.stdout).filter(record => record.branch === branch);
    if (matches.length > 1) throw new Error(`Multiple worktrees are registered for branch ${branch}.`);
    return matches[0];
  }

  private async rediscover(record: WorktreeRecord, repository: string, managedRoot: string, expectedPath: string, srId: string, branch: string): Promise<WorktreeHandle> {
    const path = await canonicalDirectory(record.path, 'Registered worktree');
    if (!within(managedRoot, path) || path !== expectedPath) throw new Error('Registered worktree is outside its deterministic managed path.');
    return { srId, repositoryRoot: repository, branch, worktreeRoot: path, readiness: 'ready' };
  }
}
