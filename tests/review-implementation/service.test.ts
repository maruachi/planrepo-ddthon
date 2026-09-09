import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AUTHOR, type ActorContext, type CommandContext } from '../../src/shared/contracts.js';
import { unwrap } from '../../src/shared/errors.js';
import { initialWorkflow } from '../../src/aidlc-planning/policy/planning-policy.js';
import { ReviewService } from '../../src/review-implementation/services/review-service.js';
import { emptyChanges } from '../../src/sr-document-foundation/storage/store-port.js';
import { services } from '../sr-document-foundation/helpers/test-db.js';

const REVIEWER: ActorContext = { source: 'user', role: 'reviewer' };
function setup() {
  const t = services(); const review = new ReviewService(t.store, t.docs);
  const sr = unwrap(t.sr.create({ title: '리뷰 SR', description: '고정 버전 리뷰' }, AUTHOR));
  const c = emptyChanges(); c.requireSrs.push(sr.id);
  c.planning = { expectedRevision: null, state: { ...initialWorkflow(sr.id), revision: 1, stageIndex: 1, column: 'inception' } }; unwrap(t.store.commit(c));
  const generated = unwrap(t.docs.prepareGenerated(sr.id, randomUUID(), [{ logicalKey: 'plan', title: '계획', body: 'PRIVATE_DOCUMENT_BODY' }])); unwrap(t.store.commit(generated));
  const target = generated.pointers[0]!;
  const move = (column: 'construction' | 'implementation_ready') => {
    const old = unwrap(t.store.read({ kind: 'workflow', srId: sr.id }))!; const changes = emptyChanges(); changes.requireSrs.push(sr.id);
    changes.planning = { expectedRevision: old.revision, state: { ...old, revision: old.revision + 1, column, status: column === 'implementation_ready' ? 'complete' : old.status } }; unwrap(t.store.commit(changes));
  };
  return { ...t, srService: t.sr, review, sr, target, move };
}

describe('ReviewService', () => {
  it('binds requests/results to the original version and preserves workflow while reporting the latest separately', () => {
    const t = setup(); try {
      const before = unwrap(t.store.read({ kind: 'workflow', srId: t.sr.id }));
      const requested = unwrap(t.review.request(t.sr.id, { target: t.target, comment: '흐름을 검토해 주세요.' }, AUTHOR));
      const newer = unwrap(t.docs.edit(t.target, '수정한 최신 본문', AUTHOR)).view;
      const loaded = unwrap(t.review.getReview(t.sr.id, requested.id));
      expect(loaded).toMatchObject({ target: t.target, isLatest: false, latestVersionRef: newer.latestVersionRef, versionNumber: 1 });
      const decided = unwrap(t.review.submitResult(t.sr.id, requested.id, { kind: 'approve', comment: '원래 버전만 승인합니다.' }, REVIEWER));
      expect(decided).toMatchObject({ status: 'approved', target: t.target, versionNumber: 1, isLatest: false, requestComment: requested.requestComment });
      expect(unwrap(t.store.read({ kind: 'workflow', srId: t.sr.id }))).toEqual(before);
      expect(unwrap(t.store.read({ kind: 'sr', srId: t.sr.id })).column).toBe('inception');
      expect(unwrap(t.docs.listVersions(t.sr.id, t.target.documentId)).items).toHaveLength(2);
      const events = unwrap(t.docs.listHistory(t.sr.id)).items.filter(event => event.kind.startsWith('review_'));
      expect(events).toHaveLength(2);
      for (const event of events) {
        const full = unwrap(t.store.read({ kind: 'event', srId: t.sr.id, eventId: event.id }));
        expect(full.versionRefs).toEqual([t.target]); expect(full.actor.role).toBe(full.kind === 'review_requested' ? 'author' : 'reviewer');
        expect(full.details).toMatchObject({ reviewId: requested.id, target: t.target });
        expect(JSON.stringify(full)).not.toContain('PRIVATE_DOCUMENT_BODY'); expect(JSON.stringify(full)).not.toContain('수정한 최신 본문');
      }
    } finally { t.close(); }
  });

  it('allows past-version requests and late results after the SR leaves planning', () => {
    const t = setup(); try {
      unwrap(t.docs.edit(t.target, '더 최신 내용', AUTHOR)); t.move('construction');
      const requested = unwrap(t.review.request(t.sr.id, { target: t.target, comment: '과거 버전 확인' }, AUTHOR)); expect(requested.isLatest).toBe(false);
      t.move('implementation_ready'); const state = unwrap(t.store.read({ kind: 'workflow', srId: t.sr.id }));
      expect(t.review.request(t.sr.id, { target: t.target, comment: '새 요청' }, AUTHOR)).toMatchObject({ ok: false, error: { code: 'REVIEW_ACTION_BLOCKED' } });
      expect(unwrap(t.review.submitResult(t.sr.id, requested.id, { kind: 'request_changes', comment: '다음 버전에 반영할 수정입니다.' }, REVIEWER)).status).toBe('changes_requested');
      expect(unwrap(t.store.read({ kind: 'workflow', srId: t.sr.id }))).toEqual(state);
    } finally { t.close(); }
  });

  it('enforces roles, target ownership and required bounded comments before storing changes', () => {
    const t = setup(); try {
      for (const actor of [REVIEWER, { source: 'ai', role: 'author' } as ActorContext]) expect(t.review.request(t.sr.id, { target: t.target, comment: '요청' }, actor)).toMatchObject({ ok: false, error: { code: 'ROLE_REQUIRED' } });
      for (const comment of [' ', 'x'.repeat(65537)]) expect(t.review.request(t.sr.id, { target: t.target, comment }, AUTHOR).ok).toBe(false);
      const other = unwrap(t.srService.create({ title: '다른 SR', description: '별도' }, AUTHOR));
      expect(t.review.request(t.sr.id, { target: { ...t.target, srId: other.id }, comment: '요청' }, AUTHOR)).toMatchObject({ ok: false, error: { code: 'REFERENCE_MISMATCH' } });
      expect(unwrap(t.review.listReviews(t.sr.id)).items).toHaveLength(0);
      const requested = unwrap(t.review.request(t.sr.id, { target: t.target, comment: '요청' }, AUTHOR));
      expect(t.review.getReview(other.id, requested.id)).toMatchObject({ ok: false, error: { code: 'REFERENCE_MISMATCH' } });
      expect(t.review.submitResult(t.sr.id, requested.id, { kind: 'approve', comment: '결과' }, AUTHOR)).toMatchObject({ ok: false, error: { code: 'ROLE_REQUIRED' } });
      for (const comment of [' ', 'x'.repeat(65537)]) expect(t.review.submitResult(t.sr.id, requested.id, { kind: 'approve', comment }, REVIEWER).ok).toBe(false);
      expect(unwrap(t.review.getReview(t.sr.id, requested.id)).status).toBe('requested');
    } finally { t.close(); }
  });

  it('replays receipts after mutable state changes and rejects a different second result', () => {
    const t = setup(); try {
      const requestCommand: CommandContext = { operationId: randomUUID(), kind: 'review_request', fingerprint: 'request-original' };
      const input = { target: t.target, comment: '요청' }; const requested = unwrap(t.review.request(t.sr.id, input, AUTHOR, requestCommand));
      t.move('implementation_ready');
      expect(unwrap(t.review.request(t.sr.id, input, AUTHOR, requestCommand)).id).toBe(requested.id);
      const resultCommand: CommandContext = { operationId: randomUUID(), kind: 'review_result', fingerprint: 'result-original' };
      const result = { kind: 'approve' as const, comment: '검토 완료' };
      const first = unwrap(t.review.submitResult(t.sr.id, requested.id, result, REVIEWER, resultCommand));
      expect(unwrap(t.review.submitResult(t.sr.id, requested.id, result, REVIEWER, resultCommand))).toEqual(first);
      expect(t.review.submitResult(t.sr.id, requested.id, result, REVIEWER, { ...resultCommand, fingerprint: 'changed' })).toMatchObject({ ok: false, error: { code: 'OPERATION_CONFLICT' } });
      expect(t.review.submitResult(t.sr.id, requested.id, result, REVIEWER)).toMatchObject({ ok: false, error: { code: 'REVIEW_CONFLICT' } });
      expect(unwrap(t.review.listReviews(t.sr.id)).items).toHaveLength(1);
      expect(unwrap(t.docs.listHistory(t.sr.id)).items.filter(event => event.kind.startsWith('review_'))).toHaveLength(2);
    } finally { t.close(); }
  });

  it('paginates review views without changing original target versions', () => {
    const t = setup(); try {
      for (let i = 0; i < 3; i++) unwrap(t.review.request(t.sr.id, { target: t.target, comment: `요청 ${i}` }, AUTHOR));
      const first = unwrap(t.review.listReviews(t.sr.id, { limit: 2 })); expect(first.items).toHaveLength(2); expect(first.nextCursor).toBeTruthy();
      const second = unwrap(t.review.listReviews(t.sr.id, { limit: 2, cursor: first.nextCursor! })); expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map(review => review.id)).size).toBe(3);
      for (const review of [...first.items, ...second.items]) expect(review).toMatchObject({ target: t.target, versionNumber: 1, isLatest: true });
    } finally { t.close(); }
  });
});
