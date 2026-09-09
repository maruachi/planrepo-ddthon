import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDirty } from '../../app/WorkspaceShell.js';
import { api, isPage, versionRoute } from '../../shared/client/api-client.js';
import type { VersionRef } from '../../shared/contracts.js';
import type { Column } from '../../shared/limits.js';
import type { DemoRole, ReviewView } from '../../shared/review-contracts.js';
import { ConfirmDialog } from '../../sr-document-foundation/ui/ConfirmDialog.js';
import { isWorkflow } from '../../aidlc-planning/ui/planning-client.js';
import { isReview, reviewBase, ReviewMutation, validComment, type ReviewMutationState } from './review-client.js';
import './review.css';

type Props = { srId: string; column: Column; target?: VersionRef; role: DemoRole; revision: number; workflowRevision: number; changed: () => void };
const statusText = { requested: '리뷰 대기', approved: '리뷰 승인', changes_requested: '수정 요청' };
export function ReviewPanel(props: Props) { return <ReviewPanelContent key={`${props.srId}:${props.role}`} {...props} />; }
function ReviewPanelContent({ srId, column, target, role, revision, workflowRevision, changed }: Props) {
  const [reviews, setReviews] = useState<ReviewView[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0); const [pendingOnly, setPendingOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [mutation, setMutation] = useState<ReviewMutationState>({ status: 'idle' });
  const [dialog, setDialog] = useState<'complete' | 'new' | undefined>(undefined); const [preparing, setPreparing] = useState(false);
  const mounted = useRef(true); const generation = useRef(0); const handled = useRef<string | undefined>(undefined); const submittedDraft = useRef<string | undefined>(undefined);
  const changedRef = useRef(changed); changedRef.current = changed;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const tracker = useMemo(() => new ReviewMutation(srId, role, state => { if (mounted.current) setMutation(state); }), [srId, role]);
  const load = useCallback(async (next?: string) => {
    const requestGeneration = ++generation.current; setLoading(true);
    try {
      const page = await api.request(`${reviewBase(srId)}/reviews?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, isPage(isReview));
      if (!mounted.current || requestGeneration !== generation.current) return;
      setReviews(previous => next ? [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))] : page.items); setCursor(page.nextCursor); setError('');
    } catch { if (mounted.current && requestGeneration === generation.current) setError('리뷰 목록을 불러오지 못했습니다.'); throw new Error('Review refresh failed'); }
    finally { if (mounted.current && requestGeneration === generation.current) setLoading(false); }
  }, [srId]);
  useEffect(() => { void load().catch(() => {}); return () => { generation.current++; }; }, [load, revision, reload]);
  useEffect(() => {
    if (mutation.status !== 'succeeded' || handled.current === mutation.operationId) return;
    handled.current = mutation.operationId;
    if (submittedDraft.current) { const key = submittedDraft.current; setDrafts(previous => ({ ...previous, [key]: '' })); }
    setReload(n => n + 1); changedRef.current();
  }, [mutation]);
  const busy = mutation.status === 'saving' || mutation.status === 'unknown' || preparing;
  useDirty(Object.values(drafts).some(Boolean) || mutation.status === 'saving' || mutation.status === 'unknown');
  const targetKey = target ? `request:${target.documentId}:${target.versionId}` : '';
  const setDraft = (key: string, value: string) => setDrafts(previous => ({ ...previous, [key]: value }));
  const requestAllowed = role === 'author' && ['inception', 'construction'].includes(column) && target?.srId === srId;
  async function submit(path: string, body: unknown, draftKey?: string, implementation = false) { if (busy) return; submittedDraft.current = draftKey; await tracker.submit(path, body, implementation); }
  return <section className="review-panel" data-testid="review-panel" aria-labelledby="review-heading"><div className="review-heading"><h2 id="review-heading">피어 리뷰</h2><label className="review-filter"><input type="checkbox" data-testid="review-pending-filter-input" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} />대기 중인 리뷰만</label></div>
    {error && <div role="alert" className="notice error"><p>{error}</p><button data-testid="review-refresh-button" onClick={() => setReload(n => n + 1)}>다시 확인</button></div>}
    {requestAllowed && target && <form data-testid="review-request-form" onSubmit={e => { e.preventDefault(); void submit('/reviews', { target, comment: drafts[targetKey] ?? '' }, targetKey); }}><h3>현재 보고 있는 버전의 리뷰 요청</h3><p><Link data-testid="review-request-target-link" to={versionRoute(target)}>요청 대상 버전 보기</Link></p><label htmlFor="review-request-comment">리뷰 요청 내용</label><textarea id="review-request-comment" data-testid="review-request-comment-input" disabled={busy} required value={drafts[targetKey] ?? ''} onChange={e => setDraft(targetKey, e.target.value)} /><p className="muted">검토할 내용을 입력해 주세요. 최대 64 KiB입니다.</p><button data-testid="review-request-submit-button" disabled={busy || !validComment(drafts[targetKey] ?? '')}>리뷰 요청</button></form>}
    {role === 'author' && ['inception', 'construction'].includes(column) && !target && <p className="muted">문서를 열면 해당 버전의 리뷰를 요청할 수 있습니다.</p>}
    <div className="review-list">{reviews.filter(review => !pendingOnly || review.status === 'requested').map(review => { const key = `result:${review.id}`; const comment = drafts[key] ?? ''; return <article className="review-item" key={review.id} data-testid={`review-item-${review.id}`}><div className="review-heading"><h3>{review.documentTitle} · v{review.versionNumber}</h3><span className="review-status">{statusText[review.status]}</span></div><p><Link data-testid={`review-original-${review.id}-link`} to={versionRoute(review.target)}>요청 당시 버전 보기</Link> · {review.isLatest ? '최신 버전' : <><span>이전 버전</span> · <Link data-testid={`review-latest-${review.id}-link`} to={versionRoute(review.latestVersionRef)}>최신 버전 보기</Link></>}</p><p className="review-comment">{review.requestComment}</p><p className="muted">요청일 {new Date(review.requestedAt).toLocaleString('ko-KR')}</p>{review.resultComment !== undefined && <div className="review-result"><strong>리뷰 결과</strong><p className="review-comment">{review.resultComment}</p></div>}{role === 'reviewer' && review.status === 'requested' && <form data-testid={`review-result-${review.id}-form`} onSubmit={e => { e.preventDefault(); void submit(`/reviews/${encodeURIComponent(review.id)}/results`, { kind: 'approve', comment }, key); }}><label htmlFor={`review-result-${review.id}`}>원래 버전을 확인한 후 리뷰 결과를 작성해 주세요.</label><textarea id={`review-result-${review.id}`} data-testid={`review-result-${review.id}-input`} required disabled={busy} value={comment} onChange={e => setDraft(key, e.target.value)} /><p className="muted">결과 내용은 필수이며 최대 64 KiB입니다.</p><div className="review-actions"><button data-testid={`review-approve-${review.id}-button`} disabled={busy || !validComment(comment)}>리뷰 승인</button><button type="button" data-testid={`review-changes-${review.id}-button`} disabled={busy || !validComment(comment)} onClick={() => void submit(`/reviews/${encodeURIComponent(review.id)}/results`, { kind: 'request_changes', comment }, key)}>수정 요청</button></div></form>}</article>; })}</div>
    {!loading && reviews.filter(r => !pendingOnly || r.status === 'requested').length === 0 && <p className="muted">{pendingOnly ? '불러온 목록에 대기 중인 리뷰가 없습니다.' : '아직 리뷰 요청이 없습니다.'}</p>}
    {loading && <p role="status">리뷰를 불러오는 중…</p>}{cursor && <button data-testid="review-load-more-button" disabled={loading} onClick={() => void load(cursor).catch(() => {})}>리뷰 더 보기</button>}
    {role === 'author' && column === 'implementation_ready' && <div className="review-implementation"><h3>구현 완료 기록</h3><p>구현을 마쳤다면 완료 상태를 직접 기록할 수 있습니다.</p><button data-testid="review-mark-implemented-button" disabled={busy} onClick={() => setDialog('complete')}>구현 완료로 표시</button></div>}
    {mutation.status === 'saving' && <p role="status">처리 중…</p>}{mutation.error && <div className="notice error" role="alert"><p>{mutation.error.message}</p><button data-testid="review-error-refresh-button" onClick={() => { setReload(n => n + 1); changedRef.current(); }}>최신 상태 확인</button></div>}
    {mutation.status === 'unknown' && <div className="notice" role="alert"><p>{mutation.message}</p><div className="review-actions"><button data-testid="review-operation-check-button" disabled={preparing} onClick={() => void tracker.check()}>처리 결과 다시 확인</button><button data-testid="review-operation-reset-button" disabled={preparing} onClick={() => setDialog('new')}>새 시도 준비</button></div></div>}
    {dialog === 'complete' && <ConfirmDialog title="구현 완료로 기록할까요?" label="완료 선언 및 기록" cancel={() => setDialog(undefined)} confirm={() => { setDialog(undefined); void submit('/implementation', { revision: workflowRevision }, undefined, true); }}><p>이 동작은 작성자가 구현 완료를 선언하는 수동 기록입니다. 코드 실행이나 빌드 결과를 확인하지 않습니다.</p><p>대기 중인 피어 리뷰가 있어도 완료로 기록됩니다.</p></ConfirmDialog>}
    {dialog === 'new' && <ConfirmDialog title="새 시도를 준비할까요?" label="최신 상태 확인 후 준비" busy={preparing} cancel={() => setDialog(undefined)} confirm={() => { setPreparing(true); void Promise.all([load(), api.request(`${reviewBase(srId)}/workflow`, isWorkflow)]).then(() => { if (mounted.current) { tracker.prepareNewAttempt(true); changedRef.current(); } }).catch(() => { if (mounted.current) setError('최신 상태를 확인하지 못했습니다. 기존 입력을 유지합니다.'); }).finally(() => { if (mounted.current) { setPreparing(false); setDialog(undefined); } }); }}><p>이전 요청의 처리 결과는 아직 알 수 없습니다. 새 요청을 보내면 같은 작업이 중복될 수 있습니다.</p><p>최신 상태를 확인하고 입력을 유지합니다. 계속하려면 원하는 동작을 다시 눌러 주세요.</p></ConfirmDialog>}
  </section>;
}
