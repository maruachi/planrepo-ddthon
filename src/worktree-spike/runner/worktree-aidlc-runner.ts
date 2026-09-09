import { spawn } from 'node:child_process';
import type { WorktreeAidlcRunnerPort, RunRequest, WorktreeRunResult } from '../contracts.js';
import { RESUME_PROMPT } from '../contracts.js';

const DEFAULT_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface WorktreeLauncherRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  input: string;
  shell: false;
  signal: AbortSignal;
  outputBytes: number;
  timeoutMs: number;
}

export type WorktreeLauncher = (request: WorktreeLauncherRequest) => Promise<WorktreeRunResult>;

function launcherError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const defaultLauncher: WorktreeLauncher = request => new Promise((resolve, reject) => {
  const child = spawn(request.executable, [...request.args], {
    cwd: request.cwd,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  let outputBytes = 0;
  let terminalError: Error | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The process has already exited.
    }
  };
  const stop = (error: Error) => {
    if (terminalError) return;
    terminalError = error;
    kill('SIGTERM');
    forceTimer = setTimeout(() => kill('SIGKILL'), 250);
  };
  const abort = () => stop(launcherError('CLI_CANCELLED', 'Worktree AI-DLC run was cancelled.'));
  const timeout = setTimeout(() => stop(launcherError('CLI_TIMEOUT', 'Worktree AI-DLC run timed out.')), request.timeoutMs);
  const collect = (chunk: Buffer | string, keep: boolean) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    outputBytes += bytes.length;
    if (outputBytes > request.outputBytes) {
      stop(launcherError('CLI_OUTPUT_TOO_LARGE', 'Worktree AI-DLC output exceeded the configured limit.'));
    } else if (keep && !terminalError) {
      stdout.push(bytes);
    }
  };
  const cleanup = () => {
    clearTimeout(timeout);
    if (forceTimer) clearTimeout(forceTimer);
    request.signal.removeEventListener('abort', abort);
  };

  request.signal.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', chunk => collect(chunk, true));
  child.stderr.on('data', chunk => collect(chunk, false));
  child.stdin.on('error', () => stop(launcherError('CLI_FAILED', 'Unable to write the resume prompt.')));
  child.on('error', error => { terminalError ??= error; });
  child.on('close', code => {
    cleanup();
    if (terminalError) reject(terminalError);
    else resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8') });
  });

  if (request.signal.aborted) abort();
  else child.stdin.end(request.input);
});

export interface WorktreeAidlcRunnerOptions {
  executable?: string;
  launcher?: WorktreeLauncher;
  outputBytes?: number;
  timeoutMs?: number;
}

/** Runs the resume prompt only in the provisioned worktree and owns every child lifecycle. */
export class WorktreeAidlcRunner implements WorktreeAidlcRunnerPort {
  private closed = false;
  private readonly controllers = new Set<AbortController>();
  private readonly pending = new Set<Promise<WorktreeRunResult>>();
  private readonly launcher: WorktreeLauncher;

  constructor(private readonly options: WorktreeAidlcRunnerOptions = {}) {
    this.launcher = options.launcher ?? defaultLauncher;
  }

  async run(request: RunRequest): Promise<WorktreeRunResult> {
    if (this.closed) throw launcherError('CLI_CANCELLED', 'Worktree AI-DLC runner is closed.');
    if (request.prompt !== RESUME_PROMPT) throw launcherError('INVALID_PROMPT', 'Only the frozen resume prompt is permitted.');

    const controller = new AbortController();
    this.controllers.add(controller);
    const task = this.launcher({
      executable: this.options.executable ?? 'claude',
      args: ['--print', '--output-format', 'text', '--no-session-persistence'],
      cwd: request.worktreeRoot,
      input: request.prompt,
      shell: false,
      signal: controller.signal,
      outputBytes: this.options.outputBytes ?? DEFAULT_OUTPUT_BYTES,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
      this.controllers.delete(controller);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.pending]);
  }
}
