import { parentPort } from 'node:worker_threads';
import { compareLines } from './line-diff.js';
import type { DiffInput } from './diff-contracts.js';
parentPort?.on('message', (input: DiffInput) => { parentPort!.postMessage(compareLines(input)); });
