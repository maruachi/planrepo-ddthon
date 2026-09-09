import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deserializeScopedManifest,
  diffScopedManifests,
  ScopedManifestService,
  serializeScopedManifest,
} from '../../../src/worktree-spike/manifest/scoped-manifest.js';

const temporaryRoots: string[] = [];
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ScopedManifestService', () => {
  it('captures only root control files and aidlc-docs Markdown with deterministic SHA-256 entries', async () => {
    const root = await temporaryRoot('planrepo-manifest-');
    const outside = await temporaryRoot('planrepo-manifest-outside-');
    await mkdir(join(root, 'aidlc-docs', 'nested'), { recursive: true });
    await mkdir(join(root, 'aidlc-docs', '.git'), { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'agents');
    await writeFile(join(root, 'CLAUDE.md'), 'claude');
    await writeFile(join(root, 'README.md'), 'readme');
    await writeFile(join(root, 'aidlc-docs', 'state.md'), 'state');
    await writeFile(join(root, 'aidlc-docs', 'nested', 'plan.md'), 'plan');
    await writeFile(join(root, 'aidlc-docs', 'nested', 'ignored.txt'), 'ignored');
    await writeFile(join(root, 'aidlc-docs', '.git', 'secret.md'), 'secret');
    await writeFile(join(outside, 'outside.md'), 'outside');
    await symlink(join(outside, 'outside.md'), join(root, 'aidlc-docs', 'external.md'));
    await symlink(join(root, 'aidlc-docs', 'state.md'), join(root, 'aidlc-docs', 'internal.md'));

    await expect(new ScopedManifestService().capture(root)).resolves.toEqual({
      entries: [
        { path: 'AGENTS.md', hash: hash('agents') },
        { path: 'aidlc-docs/nested/plan.md', hash: hash('plan') },
        { path: 'aidlc-docs/state.md', hash: hash('state') },
        { path: 'CLAUDE.md', hash: hash('claude') },
      ],
    });
  });

  it('returns sorted created, modified, and deleted paths with canonical snapshots', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const c = 'c'.repeat(64);
    expect(diffScopedManifests(
      { entries: [{ path: 'CLAUDE.md', hash: a }, { path: 'aidlc-docs/deleted.md', hash: a }, { path: 'aidlc-docs/changed.md', hash: a }] },
      { entries: [{ path: 'aidlc-docs/new.md', hash: c }, { path: 'aidlc-docs/changed.md', hash: b }, { path: 'CLAUDE.md', hash: a }] },
    )).toEqual({
      before: { entries: [{ path: 'aidlc-docs/changed.md', hash: a }, { path: 'aidlc-docs/deleted.md', hash: a }, { path: 'CLAUDE.md', hash: a }] },
      after: { entries: [{ path: 'aidlc-docs/changed.md', hash: b }, { path: 'aidlc-docs/new.md', hash: c }, { path: 'CLAUDE.md', hash: a }] },
      created: ['aidlc-docs/new.md'],
      modified: ['aidlc-docs/changed.md'],
      deleted: ['aidlc-docs/deleted.md'],
    });
  });

  it('serializes deterministically, deserializes to sorted entries, and rejects duplicate or escaping paths', () => {
    const a = 'a'.repeat(64);
    const unsorted = { entries: [{ path: 'CLAUDE.md', hash: a }, { path: 'AGENTS.md', hash: a }] };
    const serialized = serializeScopedManifest(unsorted);
    expect(deserializeScopedManifest(serialized)).toEqual({ entries: [{ path: 'AGENTS.md', hash: a }, { path: 'CLAUDE.md', hash: a }] });
    expect(serializeScopedManifest({ entries: [...unsorted.entries].reverse() })).toBe(serialized);
    expect(() => deserializeScopedManifest(JSON.stringify({ entries: [{ path: '../AGENTS.md', hash: a }] }))).toThrow('Invalid managed manifest path');
    expect(() => deserializeScopedManifest(JSON.stringify({ entries: [{ path: 'AGENTS.md', hash: a }, { path: 'AGENTS.md', hash: a }] }))).toThrow('Duplicate manifest path');
  });
});
