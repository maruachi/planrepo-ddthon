import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { openDatabase } from '../../src/sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../../src/sr-document-foundation/storage/sqlite-store.js';
import { unwrap } from '../../src/shared/errors.js';
import { SQLiteWorktreeSpikePersistence } from '../../src/worktree-spike/storage/sqlite-worktree-spike-persistence.js';
import { WorktreeSpikeService } from '../../src/worktree-spike/worktree-spike-service.js';
import type { WorktreeSpikeView } from '../../src/worktree-spike/contracts.js';
import { srFixture } from '../sr-document-foundation/helpers/fixtures.js';

test('restores the changed document tree and body after the database and service restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planrepo-worktree-persistence-'));
  const dbPath = join(root, 'planrepo.sqlite');
  const worktreeRoot = join(root, 'worktree');
  const documentPath = 'aidlc-docs/inception/requirements/requirements.md';
  const body = '# 재시작 후에도 보이는 문서\n';
  await mkdir(join(worktreeRoot, 'aidlc-docs/inception/requirements'), { recursive: true });
  await writeFile(join(worktreeRoot, documentPath), body);
  const hash = createHash('sha256').update(body).digest('hex');
  let db = openDatabase(dbPath);
  try {
    const change = srFixture();
    unwrap(new SQLiteStore(db).commit(change));
    const srId = change.sr!.id;
    const view: WorktreeSpikeView = {
      srId,
      configured: true,
      readiness: 'ready',
      branch: `planrepo/sr/${srId}`,
      worktreeRoot,
      currentStage: 'Requirements Analysis',
      firstIncomplete: '요구사항 승인',
      runStatus: 'succeeded',
      sessionId: '11111111-1111-4111-8111-111111111111',
      interactionStatus: 'succeeded',
      transcript: [{ sequence: 1, role: 'assistant', text: '계속할까요?', createdAt: '2026-09-09T00:00:01.000Z' }],
      changedPaths: [documentPath],
      documents: [{ srId, path: documentPath, change: 'created', hash, versionId: `legacy:${hash}`, versionNumber: 1, origin: 'ai_generated', createdAt: '2026-09-09T00:00:00.000Z', editable: true }],
    };
    new SQLiteWorktreeSpikePersistence(db).save(view);
    db.close();

    db = openDatabase(dbPath);
    const service = new WorktreeSpikeService({
      repositoryRoot: join(root, 'repository'),
      workspaceRoot: join(root, 'worktrees'),
      git: { provision: vi.fn() },
      state: { parse: vi.fn() },
      manifest: { capture: vi.fn(), diff: vi.fn() },
      runner: { run: vi.fn(), close: vi.fn(async () => {}) },
      persistence: new SQLiteWorktreeSpikePersistence(db),
    });

    expect(service.get(srId)).toEqual(view);
    await expect(service.document(srId, documentPath)).resolves.toMatchObject({ path: documentPath, change: 'created', hash, body, isLatest: true });
    expect(db.pragma('user_version', { simple: true })).toBe(7);
  } finally {
    if (db.open) db.close();
    await rm(root, { recursive: true, force: true });
  }
});
