import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { unwrap } from '../../src/shared/errors.js';
import { openDatabase } from '../../src/sr-document-foundation/storage/database.js';
import { SQLiteWorktreeDocumentHistory } from '../../src/worktree-spike/storage/sqlite-worktree-document-history.js';
import { SQLiteWorktreeSpikePersistence } from '../../src/worktree-spike/storage/sqlite-worktree-spike-persistence.js';
import { WorktreeDocumentWriter } from '../../src/worktree-spike/files/worktree-document-writer.js';
import { ScopedManifestService } from '../../src/worktree-spike/manifest/scoped-manifest.js';
import { WorktreeSpikeService } from '../../src/worktree-spike/worktree-spike-service.js';
import { srFixture } from '../sr-document-foundation/helpers/fixtures.js';
import { testDB } from '../sr-document-foundation/helpers/test-db.js';

const digest = (body: string) => createHash('sha256').update(body).digest('hex');

test('stores immutable AI and human versions, deduplicates latest hash, replays edits, and survives restart', () => {
  const fixture = testDB(); const sr = srFixture(); unwrap(fixture.store.commit(sr)); const srId = sr.sr!.id;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const history = new SQLiteWorktreeDocumentHistory(fixture.db, () => '2026-09-09T01:00:00.000Z', () => ids.shift()!);
  const path = 'aidlc-docs/inception/requirements/example.md';
  const firstBody = '# AI v1\n'; const firstHash = digest(firstBody);
  const first = history.recordSnapshot({ srId, path, body: firstBody, hash: firstHash, origin: 'ai_generated', change: 'created', sourceOperationId: randomUUID() });
  expect(first).toMatchObject({ versionNumber: 1, origin: 'ai_generated', body: firstBody, isLatest: true });

  const duplicate = history.recordSnapshot({ srId, path, body: firstBody, hash: firstHash, origin: 'ai_generated', change: 'unchanged' });
  expect(duplicate.versionId).toBe(first.versionId);
  expect(history.listVersions(srId, path)).toHaveLength(1);

  const secondBody = '# Human v2\n'; const secondHash = digest(secondBody); const operationId = randomUUID();
  const second = history.recordHumanEdit({ srId, path, body: secondBody, hash: secondHash, origin: 'human_edit', change: 'modified', operationId, sourceOperationId: operationId, fingerprint: 'edit-fingerprint', expectedHash: firstHash });
  expect(second).toMatchObject({ changed: true, view: { versionNumber: 2, origin: 'human_edit', body: secondBody, previousVersionId: first.versionId, isLatest: true } });
  expect(history.editReceipt(operationId, 'edit-fingerprint')).toEqual(second);
  expect(() => history.editReceipt(operationId, 'different')).toThrow('같은 작업 ID');
  expect(history.listVersions(srId, path).map(item => item.versionNumber)).toEqual([2, 1]);
  expect(history.readVersion(srId, path, first.versionId)).toMatchObject({ body: firstBody, isLatest: false });
  expect(history.listDocuments(srId)[0]).toMatchObject({ path, hash: secondHash, versionNumber: 2, editable: true });
  expect(() => fixture.db.prepare('UPDATE worktree_document_versions SET body=? WHERE id=?').run('changed', first.versionId)).toThrow('immutable');
  expect(() => fixture.db.prepare('DELETE FROM worktree_document_versions WHERE id=?').run(first.versionId)).toThrow('immutable');

  fixture.db.close();
  const reopened = openDatabase(fixture.path);
  try {
    const afterRestart = new SQLiteWorktreeDocumentHistory(reopened);
    expect(afterRestart.readVersion(srId, path)).toMatchObject({ versionNumber: 2, hash: secondHash, body: secondBody });
    expect(afterRestart.editReceipt(operationId, 'edit-fingerprint')).toMatchObject({ changed: true, view: { versionId: second.view.versionId } });
  } finally { reopened.close(); fixture.close(); }
});

test('rejects stale expected hashes and marks state and audit documents read-only', () => {
  const fixture = testDB(); const sr = srFixture(); unwrap(fixture.store.commit(sr)); const srId = sr.sr!.id;
  const history = new SQLiteWorktreeDocumentHistory(fixture.db);
  const path = 'aidlc-docs/plan.md'; const body = 'base'; const hash = digest(body);
  history.recordSnapshot({ srId, path, body, hash, origin: 'ai_generated', change: 'created' });
  expect(() => history.recordHumanEdit({ srId, path, body: 'next', hash: digest('next'), origin: 'human_edit', change: 'modified', operationId: randomUUID(), fingerprint: 'stale', expectedHash: '0'.repeat(64) })).toThrow('최신 Worktree 문서');
  for (const protectedPath of ['aidlc-docs/aidlc-state.md', 'aidlc-docs/audit.md']) {
    const protectedBody = '# protected';
    const view = history.recordSnapshot({ srId, path: protectedPath, body: protectedBody, hash: digest(protectedBody), origin: 'ai_generated', change: 'created' });
    expect(view.editable).toBe(false);
  }
  fixture.close();
});

test('collects a complete AI run, saves a human edit, preserves it on an unchanged run, and reloads after service restart', async () => {
  const fixture = testDB(); const sr = srFixture(); unwrap(fixture.store.commit(sr)); const srId = sr.sr!.id;
  const worktreeRoot = join(fixture.dir, 'worktree'); const path = 'aidlc-docs/inception/plan.md';
  await mkdir(join(worktreeRoot, 'aidlc-docs', 'inception'), { recursive: true });
  let runs = 0;
  const runner = { run: vi.fn(async () => {
    runs++;
    if (runs === 1) await writeFile(join(worktreeRoot, path), '# AI v1\n');
    else expect(await readFile(join(worktreeRoot, path), 'utf8')).toBe('# Human v2\n');
    return { exitCode: 0, stdout: 'ok' };
  }), close: vi.fn(async () => {}) };
  const dependencies = {
    repositoryRoot: fixture.dir,
    workspaceRoot: fixture.dir,
    git: { provision: vi.fn(async () => ({ srId, repositoryRoot: fixture.dir, branch: `planrepo/sr/${srId}`, worktreeRoot, readiness: 'ready' as const })) },
    state: { parse: vi.fn(async () => ({ statePath: join(worktreeRoot, 'aidlc-docs/aidlc-state.md'), currentStage: 'Code Generation', status: 'parsed' as const })) },
    manifest: new ScopedManifestService(), runner,
    requirements: { get: () => sr.sr! },
    persistence: new SQLiteWorktreeSpikePersistence(fixture.db), history: new SQLiteWorktreeDocumentHistory(fixture.db), writer: new WorktreeDocumentWriter(),
  };
  const service = new WorktreeSpikeService(dependencies);
  await service.provision(srId, randomUUID());
  const firstRun = await service.resume(srId, randomUUID());
  expect(firstRun.documents).toHaveLength(1); expect(firstRun.documents[0]).toMatchObject({ path, versionNumber: 1, origin: 'ai_generated', change: 'created' });
  const first = await service.document(srId, path);
  const edited = await service.edit(srId, randomUUID(), { path, expectedHash: first.hash, body: '# Human v2\n' });
  expect(edited).toMatchObject({ changed: true, view: { versionNumber: 2, origin: 'human_edit', body: '# Human v2\n' } });
  const unchangedRun = await service.resume(srId, randomUUID());
  expect(unchangedRun.documents[0]).toMatchObject({ versionNumber: 2, origin: 'human_edit', change: 'unchanged' });
  expect(service.versions(srId, path).map(item => item.versionNumber)).toEqual([2, 1]);

  const restarted = new WorktreeSpikeService({ ...dependencies, runner: { run: vi.fn(), close: vi.fn(async () => {}) } });
  expect(restarted.get(srId).documents[0]).toMatchObject({ versionNumber: 2, origin: 'human_edit' });
  await expect(restarted.document(srId, path)).resolves.toMatchObject({ body: '# Human v2\n', versionNumber: 2 });
  await expect(restarted.document(srId, path, first.versionId)).resolves.toMatchObject({ body: '# AI v1\n', isLatest: false });
  fixture.close();
});

test('asks the writer to restore original bytes when metadata commit fails', async () => {
  const srId = randomUUID(); const path = 'aidlc-docs/plan.md'; const original = '# original\n'; const originalHash = digest(original); const replacement = '# replacement\n'; const replacementHash = digest(replacement);
  const summary = { srId, path, hash: originalHash, change: 'created' as const, editable: true, versionId: randomUUID(), versionNumber: 1, origin: 'ai_generated' as const, createdAt: '2026-09-09T00:00:00.000Z' };
  const restore = vi.fn(async () => {});
  const service = new WorktreeSpikeService({
    repositoryRoot: '/repository', workspaceRoot: '/worktrees', git: { provision: vi.fn() }, state: { parse: vi.fn() }, manifest: { capture: vi.fn(), diff: vi.fn() }, runner: { run: vi.fn(), close: vi.fn(async () => {}) },
    persistence: { load: () => ({ srId, configured: true, readiness: 'ready', worktreeRoot: '/worktree', runStatus: 'succeeded', changedPaths: [path], documents: [summary] }), save: vi.fn() },
    history: { recordSnapshot: vi.fn(), listDocuments: vi.fn(), listVersions: vi.fn(), readVersion: vi.fn(), editReceipt: vi.fn(), recordHumanEdit: vi.fn(() => { throw new Error('metadata failed'); }) },
    writer: { write: vi.fn(async () => ({ changed: true, hash: replacementHash, body: replacement, rollback: { body: new TextEncoder().encode(original), mode: 0o640 } })), restore },
  });
  await expect(service.edit(srId, randomUUID(), { path, expectedHash: originalHash, body: replacement })).rejects.toThrow('metadata failed');
  expect(restore).toHaveBeenCalledWith('/worktree', path, replacementHash, expect.objectContaining({ mode: 0o640 }));
});
