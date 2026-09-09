import { expect, test } from 'vitest';
import { ApiClient } from '../../../src/shared/client/api-client.js';
import { isReview, ReviewMutation, validComment } from '../../../src/review-implementation/ui/review-client.js';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const review = { id: 'review-original', srId: 's', target: { srId: 's', documentId: 'd', versionId: 'v1' }, latestVersionRef: { srId: 's', documentId: 'd', versionId: 'v2' }, isLatest: false, documentTitle: '계획', versionNumber: 1, requestComment: '원래 버전 검토', requestedAt: '2026-09-09T00:00:00Z', status: 'requested' };

test('requests send selected role and UUID and block all POSTs while result is unknown', async () => {
  const calls: RequestInit[] = [];
  const tracker = new ReviewMutation('s', 'reviewer', () => {}, new ApiClient(async (_path, init) => { calls.push(init ?? {}); throw new Error('lost'); }));
  await tracker.submit('/reviews/review-original/results', { kind: 'approve', comment: '보존할 초안' });
  expect(tracker.state.status).toBe('unknown'); expect(calls).toHaveLength(1);
  const headers = calls[0].headers as Record<string, string>; expect(headers['X-Planrepo-Role']).toBe('reviewer'); expect(headers['X-Operation-Id']).toMatch(/^[a-f0-9-]{36}$/);
  await tracker.submit('/reviews', {}); expect(calls).toHaveLength(1);
  await tracker.check(); expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
});

test('receipt resolves specific original review, preserving historical target', async () => {
  const paths: string[] = [];
  const tracker = new ReviewMutation('s', 'author', () => {}, new ApiClient(async path => { paths.push(String(path)); if (paths.length === 1) throw new Error('lost'); return response({ ok: true, data: paths.length === 2 ? { status: 'committed', receipt: { srId: 's', kind: 'review_request', reviewId: review.id } } : review }); }));
  await tracker.submit('/reviews', {}); await tracker.check();
  expect(paths[2]).toBe('/api/srs/s/reviews/review-original'); expect(tracker.state).toMatchObject({ status: 'succeeded', data: { target: { versionId: 'v1' }, isLatest: false } });
});

test('manual implementation receipt resolves SR and never sends second mutation', async () => {
  let calls = 0;
  const sr = { id: 's', title: 'SR', description: 'description', column: 'implemented', createdAt: 'now' };
  const tracker = new ReviewMutation('s', 'author', () => {}, new ApiClient(async () => { calls++; if (calls === 1) throw new Error('lost'); return response({ ok: true, data: calls === 2 ? { status: 'committed', receipt: { srId: 's', kind: 'mark_implemented' } } : sr }); }));
  await tracker.submit('/implementation', { revision: 3 }, true); await tracker.check(); expect(tracker.state).toMatchObject({ status: 'succeeded', data: sr }); expect(calls).toBe(3);
});

test('wrong review identity is not accepted as committed result', async () => {
  let calls = 0;
  const tracker = new ReviewMutation('s', 'reviewer', () => {}, new ApiClient(async () => { calls++; if (calls === 1) throw new Error('lost'); return response({ ok: true, data: calls === 2 ? { status: 'committed', receipt: { srId: 's', kind: 'review_result', reviewId: review.id } } : { ...review, id: 'other' } }); }));
  await tracker.submit('/reviews/review-original/results', {}); await tracker.check(); expect(tracker.state.status).toBe('unknown');
});

test('definite role rejection preserves explicit error and permits corrected user action', async () => {
  const tracker = new ReviewMutation('s', 'author', () => {}, new ApiClient(async () => response({ ok: false, error: { code: 'ROLE_FORBIDDEN', message: '리뷰어 역할이 필요합니다.' } }, 403)));
  await tracker.submit('/reviews/r/results', { comment: 'draft' }); expect(tracker.state).toMatchObject({ status: 'rejected', error: { code: 'ROLE_FORBIDDEN' } });
});

test('acknowledged reset sends no request and next explicit action gets a fresh UUID', async () => {
  let calls = 0;
  const tracker = new ReviewMutation('s', 'author', () => {}, new ApiClient(async () => { calls++; throw new Error('lost'); }));
  await tracker.submit('/reviews', {}); const id = tracker.state.operationId;
  expect(tracker.prepareNewAttempt(false)).toBe(false); expect(tracker.state.status).toBe('unknown');
  expect(tracker.prepareNewAttempt(true)).toBe(true); expect(tracker.state.status).toBe('idle'); expect(calls).toBe(1);
  await tracker.submit('/reviews', {}); expect(calls).toBe(2); expect(tracker.state.operationId).not.toBe(id);
});

test('review guard validates nested targets and required display fields', () => {
  expect(isReview(review)).toBe(true); expect(isReview({ ...review, target: { documentId: 'd' } })).toBe(false);
  expect(isReview({ ...review, documentTitle: undefined })).toBe(false); expect(isReview({ ...review, resultComment: 12 })).toBe(false);
});

test('comments are required and UTF-8 byte limit counts Korean text accurately', () => {
  expect(validComment(' \n ')).toBe(false); expect(validComment('a'.repeat(65536))).toBe(true);
  expect(validComment('a'.repeat(65537))).toBe(false); expect(validComment('한'.repeat(21846))).toBe(false); expect(validComment('한'.repeat(21845))).toBe(true);
});
