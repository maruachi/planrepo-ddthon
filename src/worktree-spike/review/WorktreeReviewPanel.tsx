import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDirty } from '../../app/WorkspaceShell.js';
import { api } from '../../shared/client/api-client.js';
import type { DemoRole } from '../../shared/review-contracts.js';
import { DocumentReader } from '../../sr-document-foundation/ui/DocumentReader.js';
import type { WorktreeReviewView } from './worktree-review-contracts.js';
import { validReviewComment, worktreeReviewPageGuard, WorktreeReviewMutation, worktreeReviewsPath, type WorktreeReviewMutationState } from './worktree-review-client.js';
import '../../review-implementation/ui/review.css';

const statusText = { requested: '리뷰 대기', approved: '리뷰 승인', changes_requested: '수정 요청' };
type Props = { srId: string; selectedPath?: string; role: DemoRole; revision: number; changed: () => void };

export function WorktreeReviewPanel({ srId, selectedPath, role, revision, changed }: Props) {
  const [reviews, setReviews] = useState<WorktreeReviewView[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [mutation, setMutation] = useState<WorktreeReviewMutationState>({ status: 'idle' });
  const mounted = useRef(true); const handled = useRef<string | undefined>(undefined); const changedRef = useRef(changed); changedRef.current = changed;
  const tracker = useMemo(() => new WorktreeReviewMutation(srId, role, state => { if (mounted.current) setMutation(state); }), [srId, role]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try { const page = await api.request(`${worktreeReviewsPath(srId)}?limit=100`, worktreeReviewPageGuard); if (mounted.current) { setReviews(page.items); setError(''); } }
    catch { if (mounted.current) setError('피어 리뷰 목록을 불러오지 못했습니다.'); }
    finally { if (mounted.current) setLoading(false); }
  }, [srId]);
  useEffect(() => { void load(); }, [load, revision]);
  useEffect(() => {
    if (mutation.status !== 'succeeded' || !mutation.operationId || handled.current === mutation.operationId) return;
    handled.current = mutation.operationId; setDrafts({}); void load(); changedRef.current();
  }, [mutation, load]);
  const busy = mutation.status === 'saving' || mutation.status === 'unknown';
  useDirty(Object.values(drafts).some(Boolean) || busy);
  const requestKey = selectedPath ? `request:${selectedPath}` : '';
  const submit = (path: string, body: unknown) => { if (!busy) void tracker.submit(path, body); };
  return <section className="review-panel" data-testid="worktree-review-panel" aria-labelledby="worktree-review-heading">
    <div className="review-heading"><h2 id="worktree-review-heading">피어 리뷰</h2><span className="muted">AI-DLC 문서 스냅샷 검토</span></div>
    {error && <div role="alert" className="notice error"><p>{error}</p><button onClick={() => void load()}>다시 확인</button></div>}
    {role === 'author' && selectedPath && <form data-testid="worktree-review-request-form" onSubmit={event => { event.preventDefault(); submit(worktreeReviewsPath(srId), { path: selectedPath, comment: drafts[requestKey] ?? '' }); }}>
      <h3>현재 AI-DLC 문서 리뷰 요청</h3><p className="muted">{selectedPath}</p><label htmlFor="worktree-review-request-comment">리뷰 요청 내용</label><textarea id="worktree-review-request-comment" required disabled={busy} value={drafts[requestKey] ?? ''} onChange={event => setDrafts(previous => ({ ...previous, [requestKey]: event.target.value }))} /><button disabled={busy || !validReviewComment(drafts[requestKey] ?? '')}>리뷰 요청</button>
    </form>}
    {role === 'author' && !selectedPath && <p className="muted">계획 문서 트리에서 리뷰할 AI-DLC 문서를 선택해 주세요.</p>}
    <div className="review-list">{reviews.map(review => { const key = `result:${review.id}`; const comment = drafts[key] ?? ''; return <article className="review-item" key={review.id}>
      <div className="review-heading"><h3>{review.path}</h3><span className="review-status">{statusText[review.status]}</span></div>
      <p><Link to={`/srs/${encodeURIComponent(srId)}?worktreePath=${encodeURIComponent(review.path)}`}>현재 Worktree 문서 보기</Link></p><p className="review-comment">{review.requestComment}</p><p className="muted">요청일 {new Date(review.requestedAt).toLocaleString('ko-KR')} · SHA {review.hash.slice(0, 12)}</p>
      <details><summary>리뷰 요청 당시 문서 보기</summary><DocumentReader view={{ body: review.body, versionId: `review:${review.id}` }} /></details>
      {review.resultComment && <div className="review-result"><strong>리뷰 결과</strong><p className="review-comment">{review.resultComment}</p></div>}
      {role === 'reviewer' && review.status === 'requested' && <form onSubmit={event => { event.preventDefault(); submit(`${worktreeReviewsPath(srId)}/${encodeURIComponent(review.id)}/results`, { kind: 'approve', comment }); }}><label htmlFor={`worktree-review-result-${review.id}`}>리뷰 결과</label><textarea id={`worktree-review-result-${review.id}`} required disabled={busy} value={comment} onChange={event => setDrafts(previous => ({ ...previous, [key]: event.target.value }))} /><div className="review-actions"><button disabled={busy || !validReviewComment(comment)}>리뷰 승인</button><button type="button" disabled={busy || !validReviewComment(comment)} onClick={() => submit(`${worktreeReviewsPath(srId)}/${encodeURIComponent(review.id)}/results`, { kind: 'request_changes', comment })}>수정 요청</button></div></form>}
    </article>; })}</div>
    {loading && <p role="status">피어 리뷰를 불러오는 중…</p>}{!loading && reviews.length === 0 && <p className="muted">아직 피어 리뷰 요청이 없습니다.</p>}
    {mutation.status === 'saving' && <p role="status">처리 중…</p>}{mutation.error && <p role="alert" className="notice error">{mutation.error.message}</p>}
    {mutation.status === 'unknown' && <div role="alert" className="notice"><p>{mutation.message}</p><div className="review-actions"><button onClick={() => void tracker.check()}>처리 결과 다시 확인</button><button onClick={() => tracker.reset()}>새 시도 준비</button></div></div>}
  </section>;
}
