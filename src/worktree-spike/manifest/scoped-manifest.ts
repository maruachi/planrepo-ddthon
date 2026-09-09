import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import type { ManifestDelta, ManifestEntry, ManifestPort, ScopedManifest } from '../contracts.js';

const ROOT_MANAGED_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function toManifestPath(path: string): string {
  return path.split(sep).join('/');
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

export function isManagedManifestPath(path: string): boolean {
  if (!path || path.includes('\\') || isAbsolute(path) || posix.normalize(path) !== path) return false;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment === '.git')) return false;
  return ROOT_MANAGED_FILES.has(path) || (segments[0] === 'aidlc-docs' && path.endsWith('.md'));
}

function normalizeEntries(entries: readonly ManifestEntry[]): ManifestEntry[] {
  const byPath = new Map<string, ManifestEntry>();
  for (const entry of entries) {
    if (!isManagedManifestPath(entry.path)) throw new Error(`Invalid managed manifest path: ${entry.path}`);
    if (!SHA256_PATTERN.test(entry.hash)) throw new Error(`Invalid SHA-256 hash for manifest path: ${entry.path}`);
    if (byPath.has(entry.path)) throw new Error(`Duplicate manifest path: ${entry.path}`);
    byPath.set(entry.path, { path: entry.path, hash: entry.hash });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

async function hashManagedFile(canonicalRoot: string, filePath: string): Promise<ManifestEntry | undefined> {
  let fileStat;
  try {
    fileStat = await lstat(filePath);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) return undefined;

  const canonicalFile = await realpath(filePath);
  if (!isContained(canonicalRoot, canonicalFile)) {
    throw new Error(`Managed file resolves outside the worktree: ${filePath}`);
  }
  const manifestPath = toManifestPath(relative(canonicalRoot, canonicalFile));
  if (!isManagedManifestPath(manifestPath)) return undefined;
  const contents = await readFile(canonicalFile);
  return { path: manifestPath, hash: createHash('sha256').update(contents).digest('hex') };
}

async function collectAidlcMarkdown(canonicalRoot: string, directory: string, entries: ManifestEntry[]): Promise<void> {
  let directoryStat;
  try {
    directoryStat = await lstat(directory);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return;

  const canonicalDirectory = await realpath(directory);
  if (!isContained(canonicalRoot, canonicalDirectory)) {
    throw new Error(`Managed directory resolves outside the worktree: ${directory}`);
  }

  const children = await readdir(canonicalDirectory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const child of children) {
    if (child.name === '.git' || child.isSymbolicLink()) continue;
    const childPath = resolve(canonicalDirectory, child.name);
    if (child.isDirectory()) {
      await collectAidlcMarkdown(canonicalRoot, childPath, entries);
    } else if (child.isFile() && child.name.endsWith('.md')) {
      const entry = await hashManagedFile(canonicalRoot, childPath);
      if (entry) entries.push(entry);
    }
  }
}

export function serializeScopedManifest(manifest: ScopedManifest): string {
  return `${JSON.stringify({ entries: normalizeEntries(manifest.entries) }, null, 2)}\n`;
}

export function deserializeScopedManifest(serialized: string): ScopedManifest {
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object' || !('entries' in parsed) || !Array.isArray(parsed.entries)) {
    throw new Error('Invalid scoped manifest document');
  }
  const entries = parsed.entries.map((entry: unknown): ManifestEntry => {
    if (!entry || typeof entry !== 'object' || !('path' in entry) || typeof entry.path !== 'string' || !('hash' in entry) || typeof entry.hash !== 'string') {
      throw new Error('Invalid scoped manifest entry');
    }
    return { path: entry.path, hash: entry.hash };
  });
  return { entries: normalizeEntries(entries) };
}

export function diffScopedManifests(before: ScopedManifest, after: ScopedManifest): ManifestDelta {
  const normalizedBefore: ScopedManifest = { entries: normalizeEntries(before.entries) };
  const normalizedAfter: ScopedManifest = { entries: normalizeEntries(after.entries) };
  const beforeByPath = new Map(normalizedBefore.entries.map((entry) => [entry.path, entry.hash]));
  const afterByPath = new Map(normalizedAfter.entries.map((entry) => [entry.path, entry.hash]));
  const created = normalizedAfter.entries.filter((entry) => !beforeByPath.has(entry.path)).map((entry) => entry.path);
  const modified = normalizedAfter.entries.filter((entry) => beforeByPath.has(entry.path) && beforeByPath.get(entry.path) !== entry.hash).map((entry) => entry.path);
  const deleted = normalizedBefore.entries.filter((entry) => !afterByPath.has(entry.path)).map((entry) => entry.path);
  return { before: normalizedBefore, after: normalizedAfter, created, modified, deleted };
}

export class ScopedManifestService implements ManifestPort {
  async capture(worktreeRoot: string): Promise<ScopedManifest> {
    const canonicalRoot = await realpath(resolve(worktreeRoot));
    const rootStat = await lstat(canonicalRoot);
    if (!rootStat.isDirectory()) throw new Error(`Worktree root is not a directory: ${worktreeRoot}`);

    const entries: ManifestEntry[] = [];
    for (const filename of [...ROOT_MANAGED_FILES].sort((left, right) => left.localeCompare(right, 'en'))) {
      const entry = await hashManagedFile(canonicalRoot, resolve(canonicalRoot, filename));
      if (entry) entries.push(entry);
    }
    await collectAidlcMarkdown(canonicalRoot, resolve(canonicalRoot, 'aidlc-docs'), entries);
    return { entries: normalizeEntries(entries) };
  }

  diff(before: ScopedManifest, after: ScopedManifest): ManifestDelta {
    return diffScopedManifests(before, after);
  }
}
