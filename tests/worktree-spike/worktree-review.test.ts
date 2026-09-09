import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { AUTHOR, type ActorContext } from '../../src/shared/contracts.js';
import { unwrap } from '../../src/shared/errors.js';
import { SQLiteWorktreeSpikePersistence } from '../../src/worktree-spike/storage/sqlite-worktree-spike-persistence.js';
import { WorktreeSpikeService } from '../../src/worktree-spike/worktree-spike-service.js';
import { SQLiteWorktreeReviewPersistence } from '../../src/worktree-spike/review/sqlite-worktree-review-persistence.js';
import { WorktreeReviewService } from '../../src/worktree-spike/review/worktree-review-service.js';
import { testDB } from '../sr-document-foundation/helpers/test-db.js';
import { srFixture } from '../sr-document-foundation/helpers/fixtures.js';

const REVIEWER: ActorContext = { source: 'user', role: 'reviewer' };

test('reviews an immutable AI-DLC document snapshot only while the SR is in the peer review state', async () => {
  const fixture = testDB();
  try {
    const change = srFixture(); unwrap(fixture.store.commit(change)); const srId = change.sr!.id;
    fixture.db.prepare("UPDATE srs SET manual_board_column='peer_review' WHERE id=?").run(srId);
    const worktreeRoot = join(fixture.dir, 'worktree'); const path = 'aidlc-docs/requirements.md'; const body = '# 검토할 요구사항\n';
    await mkdir(join(worktreeRoot, 'aidlc-docs'), { recursive: true }); await writeFile(join(worktreeRoot, path), body);
    const hash = createHash('sha256').update(body).digest('hex');
    const spikePersistence = new SQLiteWorktreeSpikePersistence(fixture.db);
    spikePersistence.save({ srId, configured: true, readiness: 'ready', worktreeRoot, runStatus: 'succeeded', changedPaths: [path], documents: [{ srId, path, hash, change: 'created', versionId: `legacy:${hash}`, versionNumber: 1, origin: 'ai_generated', createdAt: '2026-09-09T00:00:00.000Z', editable: true }] });
    const spike = new WorktreeSpikeService({ repositoryRoot: fixture.dir, workspaceRoot: fixture.dir, git: { provision: vi.fn() }, state: { parse: vi.fn() }, manifest: { capture: vi.fn(), diff: vi.fn() }, runner: { run: vi.fn(), close: vi.fn(async () => {}) }, persistence: spikePersistence });
    const service = new WorktreeReviewService(fixture.store, spike, new SQLiteWorktreeReviewPersistence(fixture.db));

    const requestOperation = randomUUID();
    const requested = unwrap(await service.request(srId, path, '원문을 확인해 주세요.', AUTHOR, requestOperation));
    expect(requested).toMatchObject({ srId, path, hash, body, status: 'requested' });
    expect(unwrap(await service.request(srId, path, '원문을 확인해 주세요.', AUTHOR, requestOperation)).id).toBe(requested.id);
    expect(unwrap(service.list(srId)).items).toHaveLength(1);
    expect(unwrap(fixture.store.read({ kind: 'receipt', operationId: requestOperation }))).toMatchObject({ kind: 'worktree_review_request', reviewId: requested.id });

    await writeFile(join(worktreeRoot, path), '# 이후 변경된 본문\n');
    const decided = unwrap(service.decide(srId, requested.id, 'approve', '검토했습니다.', REVIEWER, randomUUID()));
    expect(decided).toMatchObject({ status: 'approved', resultComment: '검토했습니다.', body });
    expect(unwrap(service.get(srId, requested.id)).body).toBe(body);
    expect(unwrap(fixture.store.read({ kind: 'history', srId })).items.map(event => event.kind)).toEqual(expect.arrayContaining(['worktree_review_requested', 'worktree_review_approved']));
  } finally { fixture.close(); }
});

test('blocks worktree review requests outside the peer review state', async () => {
  const fixture = testDB();
  try {
    const change = srFixture(); unwrap(fixture.store.commit(change)); const srId = change.sr!.id;
    const spike = new WorktreeSpikeService({ repositoryRoot: fixture.dir, workspaceRoot: fixture.dir, git: { provision: vi.fn() }, state: { parse: vi.fn() }, manifest: { capture: vi.fn(), diff: vi.fn() }, runner: { run: vi.fn(), close: vi.fn(async () => {}) } });
    const service = new WorktreeReviewService(fixture.store, spike, new SQLiteWorktreeReviewPersistence(fixture.db));
    await expect(service.request(srId, 'aidlc-docs/a.md', '검토', AUTHOR, randomUUID())).resolves.toMatchObject({ ok: false, error: { code: 'REVIEW_ACTION_BLOCKED' } });
  } finally { fixture.close(); }
});
