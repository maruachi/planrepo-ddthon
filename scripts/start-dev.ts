import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const tsxCli = resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const viteCli = resolve(projectRoot, 'node_modules/vite/bin/vite.js');

function start(args: readonly string[]): ChildProcess {
  return spawn(process.execPath, [...args], {
    cwd: projectRoot,
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });
}

const backend = start([tsxCli, 'src/main.ts', '--dev']);
const web = start([viteCli, '--config', 'vite.config.ts']);
const children = [backend, web] as const;

let stopping = false;
let requestedSignal: NodeJS.Signals | undefined;
let internalFailureCode: number | undefined;

function signalChildren(signal: NodeJS.Signals): void {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

function stopChildren(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  signalChildren(signal);
}

function stopFromUser(signal: NodeJS.Signals): void {
  requestedSignal = signal;
  stopChildren(signal);
}

process.once('SIGINT', stopFromUser);
process.once('SIGTERM', stopFromUser);

const exits = children.map(
  (child) =>
    new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
      (resolveExit) => {
        child.once('exit', (code, signal) => resolveExit({ code, signal }));
      },
    ),
);

for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping) {
      internalFailureCode = code === null || code === 0 ? 1 : code;
      stopChildren('SIGTERM');
    }
  });
  child.once('error', () => {
    if (!stopping) {
      internalFailureCode = 1;
      stopChildren('SIGTERM');
    }
  });
}

const results = await Promise.all(exits);
const failed = results.find((result) => result.code !== 0 || result.signal !== null);
if (requestedSignal === undefined && (internalFailureCode !== undefined || failed !== undefined)) {
  process.exitCode = internalFailureCode ?? failed?.code ?? 1;
}
