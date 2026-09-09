import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { WorktreeDocumentWriter } from '../../../src/worktree-spike/files/worktree-document-writer.js';

const roots: string[] = [];
const digest = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'planrepo-writer-')); roots.push(root);
  await mkdir(join(root, 'aidlc-docs', 'inception'), { recursive: true });
  const path = 'aidlc-docs/inception/plan.md'; const target = join(root, path); const body = '# original\n';
  await writeFile(target, body); await chmod(target, 0o640);
  return { root, path, target, body, hash: digest(body) };
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test('atomically writes UTF-8 content, preserves mode, supports no-op, and restores the original', async () => {
  const item = await fixture(); const writer = new WorktreeDocumentWriter();
  const saved = await writer.write(item.root, { path: item.path, expectedHash: item.hash, body: '# 사람 편집\n' });
  expect(saved.changed).toBe(true); expect(saved.hash).toBe(digest('# 사람 편집\n'));
  expect(await readFile(item.target, 'utf8')).toBe('# 사람 편집\n');
  expect((await lstat(item.target)).mode & 0o777).toBe(0o640);
  expect(saved.rollback).toBeDefined();
  await writer.restore(item.root, item.path, saved.hash, saved.rollback!);
  expect(await readFile(item.target, 'utf8')).toBe(item.body);

  const noop = await writer.write(item.root, { path: item.path, expectedHash: item.hash, body: item.body });
  expect(noop).toMatchObject({ changed: false, hash: item.hash, body: item.body });
  expect(noop.rollback).toBeUndefined();
});

test('rejects conflicts, protected paths, traversal, symlinks, missing files, and oversized bodies without changing the target', async () => {
  const item = await fixture(); const writer = new WorktreeDocumentWriter();
  await expect(writer.write(item.root, { path: item.path, expectedHash: '0'.repeat(64), body: 'draft' })).rejects.toThrow('변경되었습니다');
  for (const path of ['aidlc-docs/aidlc-state.md', 'aidlc-docs/audit.md', '../outside.md', 'aidlc-docs/missing.md']) {
    await expect(writer.write(item.root, { path, expectedHash: item.hash, body: 'draft' })).rejects.toThrow();
  }
  const outside = join(item.root, 'outside.md'); await writeFile(outside, 'outside');
  const link = join(item.root, 'aidlc-docs', 'linked.md'); await symlink(outside, link);
  await expect(writer.write(item.root, { path: 'aidlc-docs/linked.md', expectedHash: digest('outside'), body: 'draft' })).rejects.toThrow('일반 Markdown');
  await expect(writer.write(item.root, { path: item.path, expectedHash: item.hash, body: '가'.repeat(400_000) })).rejects.toThrow('1,048,576');
  expect(await readFile(item.target, 'utf8')).toBe(item.body);
});

test('refuses compensation when the newly written file changed again', async () => {
  const item = await fixture(); const writer = new WorktreeDocumentWriter();
  const saved = await writer.write(item.root, { path: item.path, expectedHash: item.hash, body: 'saved' });
  await writeFile(item.target, 'external change');
  await expect(writer.restore(item.root, item.path, saved.hash, saved.rollback!)).rejects.toThrow('복구하지 못했습니다');
  expect(await readFile(item.target, 'utf8')).toBe('external change');
});
