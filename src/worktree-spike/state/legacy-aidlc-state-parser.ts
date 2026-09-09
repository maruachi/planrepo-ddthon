import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AidlcStateParserPort, ParsedAidlcState } from '../contracts.js';

const LEGACY_STATE_PATH = 'aidlc-docs/aidlc-state.md';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function assertContained(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`AI-DLC state path resolves outside the worktree: ${candidate}`);
  }
}

export class LegacyAidlcStateParser implements AidlcStateParserPort {
  async parse(worktreeRoot: string): Promise<ParsedAidlcState> {
    const requestedRoot = resolve(worktreeRoot);
    const requestedStatePath = join(requestedRoot, LEGACY_STATE_PATH);
    let canonicalRoot: string;

    try {
      canonicalRoot = await realpath(requestedRoot);
    } catch (error) {
      if (isMissing(error)) {
        return { statePath: requestedStatePath, status: 'missing' };
      }
      throw error;
    }

    let canonicalStatePath: string;
    try {
      const stateStat = await lstat(requestedStatePath);
      if (stateStat.isSymbolicLink()) {
        throw new Error(`AI-DLC state path must not be a symbolic link: ${requestedStatePath}`);
      }
      canonicalStatePath = await realpath(requestedStatePath);
    } catch (error) {
      if (isMissing(error)) {
        return { statePath: requestedStatePath, status: 'missing' };
      }
      throw error;
    }

    assertContained(canonicalRoot, canonicalStatePath);
    const markdown = await readFile(canonicalStatePath, 'utf8');
    const currentStage = markdown.match(/^\s*-\s+\*\*Current Stage\*\*\s*:\s*(.*?)\s*$/mu)?.[1]?.trim();
    const firstIncomplete = markdown.match(/^\s*-\s+\[\s\]\s+(.+?)\s*$/mu)?.[1]?.trim();

    return {
      statePath: requestedStatePath,
      ...(currentStage ? { currentStage } : {}),
      ...(firstIncomplete ? { firstIncomplete } : {}),
      status: 'parsed',
    };
  }
}
