import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { InteractiveRunRequest, WorktreeAidlcRunnerPort, WorktreeRunHandle, WorktreeStreamEvent, RunRequest, WorktreeRunResult } from '../contracts.js';
import { WORKTREE_RUN_TIMEOUT_MS } from '../contracts.js';
import { ClaudeStreamDecoder, encodeClaudeUserMessage } from './claude-stream-protocol.js';

const DEFAULT_OUTPUT_BYTES = 256 * 1024;

export interface WorktreeLauncherRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  input: string;
  sessionId: string;
  onEvent: (event: WorktreeStreamEvent) => void;
  shell: false;
  signal: AbortSignal;
  outputBytes: number;
  timeoutMs: number;
}

export type WorktreeLauncher = (request: WorktreeLauncherRequest) => WorktreeRunHandle;

function launcherError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const defaultLauncher: WorktreeLauncher = request => {
  const child = spawn(request.executable, [...request.args], {
    cwd: request.cwd,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const decoder = new ClaudeStreamDecoder();
  let outputBytes = 0;
  let inputClosed = false;
  let terminalError: Error | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveCompletion!: (result: WorktreeRunResult) => void;
  let rejectCompletion!: (error: Error) => void;
  const completion = new Promise<WorktreeRunResult>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });

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
  const collect = (chunk: Buffer | string, stderr: boolean) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    outputBytes += bytes.length;
    if (outputBytes > request.outputBytes) {
      stop(launcherError('CLI_OUTPUT_TOO_LARGE', 'Worktree AI-DLC output exceeded the configured limit.'));
    } else if (!terminalError) {
      try {
        if (stderr) {
          const text = bytes.toString('utf8').trim();
          if (text) request.onEvent({ role: 'error', text });
        } else {
          for (const event of decoder.push(bytes)) request.onEvent(event);
        }
      } catch {
        request.onEvent({ role: 'error', text: 'Claude stream output을 해석하지 못했습니다.' });
        stop(launcherError('CLI_PROTOCOL_ERROR', 'Claude stream output was malformed.'));
      }
    }
  };
  const cleanup = () => {
    clearTimeout(timeout);
    if (forceTimer) clearTimeout(forceTimer);
    request.signal.removeEventListener('abort', abort);
  };

  request.signal.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', chunk => collect(chunk, false));
  child.stderr.on('data', chunk => collect(chunk, true));
  child.stdin.on('error', () => stop(launcherError('CLI_FAILED', 'Unable to write to the Claude session.')));
  child.on('error', error => { terminalError ??= error; });
  child.on('close', code => {
    cleanup();
    try { for (const event of decoder.finish()) request.onEvent(event); }
    catch { terminalError ??= launcherError('CLI_PROTOCOL_ERROR', 'Claude stream output was malformed.'); }
    if (terminalError) rejectCompletion(terminalError);
    else resolveCompletion({ exitCode: code ?? 1, stdout: '' });
  });

  const send = (message: string) => new Promise<void>((resolve, reject) => {
    if (inputClosed || child.stdin.destroyed) { reject(launcherError('CLI_FAILED', 'Claude session input is closed.')); return; }
    child.stdin.write(encodeClaudeUserMessage(message), error => error ? reject(error) : resolve());
  });
  const finish = () => { if (!inputClosed) { inputClosed = true; child.stdin.end(); } };
  const cancel = () => stop(launcherError('CLI_CANCELLED', 'Worktree AI-DLC run was cancelled.'));

  if (request.signal.aborted) abort();
  else void send(request.input).catch(error => stop(error instanceof Error ? error : launcherError('CLI_FAILED', 'Unable to write the resume prompt.')));
  return { sessionId: request.sessionId, completion, send, finish, cancel };
};

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
  private readonly pending = new Set<WorktreeRunHandle>();
  private readonly launcher: WorktreeLauncher;

  constructor(private readonly options: WorktreeAidlcRunnerOptions = {}) {
    this.launcher = options.launcher ?? defaultLauncher;
  }

  start(request: InteractiveRunRequest, onEvent: (event: WorktreeStreamEvent) => void): WorktreeRunHandle {
    if (this.closed) throw launcherError('CLI_CANCELLED', 'Worktree AI-DLC runner is closed.');
    if (!request.prompt.trim()) throw launcherError('INVALID_PROMPT', 'A non-empty Claude prompt is required.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(request.sessionId)) throw launcherError('INVALID_SESSION', 'A valid Claude session ID is required.');

    const controller = new AbortController();
    this.controllers.add(controller);
    const sessionArgs = request.resume ? ['--resume', request.sessionId] : ['--session-id', request.sessionId];
    const handle = this.launcher({
      executable: this.options.executable ?? 'claude',
      args: ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', ...sessionArgs],
      cwd: request.worktreeRoot,
      input: request.prompt,
      sessionId: request.sessionId,
      onEvent,
      shell: false,
      signal: controller.signal,
      outputBytes: this.options.outputBytes ?? DEFAULT_OUTPUT_BYTES,
      timeoutMs: this.options.timeoutMs ?? WORKTREE_RUN_TIMEOUT_MS,
    });
    this.pending.add(handle);
    void handle.completion.finally(() => {
      this.pending.delete(handle);
      this.controllers.delete(controller);
    }).catch(() => undefined);
    return handle;
  }

  async run(request: RunRequest): Promise<WorktreeRunResult> {
    const handle = this.start({ ...request, sessionId: randomUUID(), resume: false }, () => undefined);
    handle.finish();
    return handle.completion;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.pending].map(handle => handle.completion));
  }
}
