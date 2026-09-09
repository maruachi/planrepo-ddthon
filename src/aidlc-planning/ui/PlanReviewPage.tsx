import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SRSummary } from '../../shared/contracts.js';
import { record } from '../../shared/client/api-client.js';
import { COLUMNS } from '../../shared/limits.js';
import { usePaged } from '../../sr-document-foundation/ui/use-query.js';
import { useRole } from '../../app/WorkspaceShell.js';
import { INCEPTION_REVIEWS, type InceptionReview, type ReviewDecision } from './plan-review-data.js';
import './planning.css';

const isSummary = (x: unknown): x is SRSummary => record(x) && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.createdAt === 'string' && COLUMNS.some(([key]) => key === x.column);
type Verdict = 'approve' | 'changes';

// 확정된 결정을 한 건씩 넘기며 승인/수정요청하는 모달 (grill-me 모달과 같은 진행 방식).
function ReviewModal({ decisions, verdicts, comments, step, total, onVerdict, onComment, setStep, onClose, onSubmit }: {
  decisions: ReviewDecision[]; verdicts: Record<string, Verdict>; comments: Record<string, string>; step: number; total: number;
  onVerdict: (id: string, v: Verdict) => void; onComment: (id: string, text: string) => void; setStep: (next: number) => void; onClose: () => void; onSubmit: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = ref.current!; dialog.showModal(); return () => { dialog.close(); previous?.focus(); }; }, []);
  const index = Math.min(Math.max(step, 0), total - 1);
  const d = decisions[index]!;
  const verdict = verdicts[d.id];
  const comment = comments[d.id] ?? '';
  const decidedCount = decisions.filter(x => verdicts[x.id]).length;
  const allDecided = decidedCount === total;
  const missingComment = decisions.some(x => verdicts[x.id] === 'changes' && !(comments[x.id] ?? '').trim());
  const last = index === total - 1;
  const currentReady = !!verdict && !(verdict === 'changes' && !comment.trim());
  return <dialog ref={ref} className="grill-modal pr-modal" data-testid="plan-review-modal" aria-labelledby="pr-modal-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="grill-head">
      <div><p className="eyebrow">확정 결정 검토</p><h2 id="pr-modal-title">{d.topic} <span className="grill-total">/ {total}중 {index + 1}번</span></h2></div>
      <button type="button" className="grill-close" data-testid="plan-review-modal-close" aria-label="닫기" onClick={onClose}>✕</button>
    </div>
    <div className="grill-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={decidedCount} aria-label={`${total}개 중 ${decidedCount}개 검토함`}>
      {decisions.map((x, i) => <span key={i} className={`grill-dot${i === index ? ' current' : ''}${verdicts[x.id] === 'approve' ? ' pr-approve' : verdicts[x.id] === 'changes' ? ' pr-changes' : ''}`} />)}
    </div>
    <div className="pr-modal-body">
      <p className="pr-question">{d.question}</p>
      <p className="pr-choice"><span className="pr-choice-label">선택</span>{d.choice}</p>
      <p className="pr-rationale">{d.rationale}</p>
      {d.caution && <p className="pr-caution">⚠ 확인 포인트 — {d.caution}</p>}
      <div className="pr-actions">
        <button type="button" className={`pr-vote${verdict === 'approve' ? ' on' : ''}`} aria-pressed={verdict === 'approve'} data-testid={`plan-review-approve-${d.id}`} onClick={() => onVerdict(d.id, 'approve')}>승인</button>
        <button type="button" className={`pr-vote pr-vote-changes${verdict === 'changes' ? ' on' : ''}`} aria-pressed={verdict === 'changes'} data-testid={`plan-review-changes-${d.id}`} onClick={() => onVerdict(d.id, 'changes')}>수정 요청</button>
      </div>
      {verdict === 'changes' && <textarea className="pr-comment" data-testid={`plan-review-comment-${d.id}`} autoFocus placeholder="어떤 점을 수정하면 좋을지 적어 주세요 (필수)" value={comment} onChange={e => onComment(d.id, e.target.value)} />}
    </div>
    <div className="grill-nav">
      <button type="button" className="quiet" data-testid="plan-review-prev" disabled={index === 0} onClick={() => setStep(index - 1)}>← 이전</button>
      <span className="grill-count muted">{decidedCount} / {total} 검토함</span>
      <div className="grill-nav-right">
        {last
          ? <button type="button" className="primary" data-testid="plan-review-submit" disabled={!allDecided || missingComment} onClick={onSubmit}>리뷰 제출</button>
          : <button type="button" className="primary" data-testid="plan-review-next" disabled={!currentReady} onClick={() => setStep(index + 1)}>다음 →</button>}
      </div>
    </div>
  </dialog>;
}

export function PlanReviewPage() {
  const role = useRole();
  const board = usePaged('/api/board', isSummary);
  const inceptionSRs = (board.data?.items ?? []).filter(s => s.column === 'inception');
  const srIdFor = (title: string) => inceptionSRs.find(s => s.title === title)?.id;
  // 아이콘이 달린(리뷰 대상) SR 만 목록에 노출한다.
  const reviews = INCEPTION_REVIEWS.filter(r => r.hasIcon);

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});

  const active = INCEPTION_REVIEWS.find(r => r.key === openKey) ?? null;

  const startReview = (review: InceptionReview) => {
    const first = review.decisions.findIndex(d => !verdicts[d.id]);
    setStep(first < 0 ? 0 : first);
    setOpenKey(review.key);
  };

  // 보드의 "리뷰 필요" 배지에서 넘어오면(?open=<key>) 해당 SR 리뷰 모달을 바로 연다.
  // 파라미터는 한 번 소비하고 지워, 모달을 닫아도 다시 열리지 않게 한다.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const key = searchParams.get('open');
    if (!key) return;
    const target = INCEPTION_REVIEWS.find(r => r.key === key && r.hasIcon);
    if (target) startReview(target);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return <div className="board-page plan-review-page" data-testid="plan-review-page">
    <div className="page-heading">
      <div><p className="eyebrow">PLAN REVIEW · INCEPTION</p><h1>Plan 리뷰(Inception)</h1></div>
      <span className="subtitle">리뷰 대기 {reviews.length}건</span>
    </div>

    <ul className="pr-list" data-testid="plan-review-list">
      {reviews.map(review => {
        const total = review.decisions.length;
        const decided = review.decisions.filter(d => verdicts[d.id]).length;
        const changes = review.decisions.filter(d => verdicts[d.id] === 'changes');
        const isDone = !!submitted[review.key];
        const srId = srIdFor(review.title);
        return <li key={review.key} className="pr-item" data-testid={`plan-review-item-${review.key}`}>
          <div className="pr-item-body">
            <div className="pr-item-head">
              {srId && <span className="pr-sr-id" data-testid={`plan-review-sr-number-${review.key}`}>SR · {srId.slice(0, 8)}</span>}
              <span className="pr-ai-badge">AI 요약</span>
              {isDone && <span className={`badge ${changes.length === 0 ? 'badge-done' : 'pr-badge-changes'}`} data-testid={`plan-review-status-${review.key}`}>{changes.length === 0 ? '전체 승인' : `수정 요청 ${changes.length}건`}</span>}
            </div>
            <h3 className="pr-item-title">{review.title}</h3>
            <p className="pr-item-summary">{review.aiSummary.split(/(?<=\.)\s+/).map((line, i) => <span key={i} className="pr-line">{line}</span>)}</p>
            <div className="pr-gauge"><span style={{ width: `${(decided / total) * 100}%` }} /></div>
            <p className="pr-progress-text">확정된 결정 {total}개 · {decided} / {total} 검토함 · 검토자 {role === 'reviewer' ? '리뷰어' : '작성자'}</p>
          </div>
          <div className="pr-item-side">
            {srId && <Link className="quiet" data-testid={`plan-review-sr-link-${review.key}`} to={`/srs/${srId}`}>보드에서 보기 ↗</Link>}
            <button type="button" className="primary pr-item-btn" data-testid={`plan-review-start-${review.key}`} onClick={() => startReview(review)}>{isDone ? '검토 다시 보기' : decided === 0 ? '리뷰 진행' : '이어서 진행'}</button>
          </div>
        </li>;
      })}
    </ul>

    {active && <ReviewModal decisions={active.decisions} verdicts={verdicts} comments={comments} step={step} total={active.decisions.length}
      onVerdict={(id, v) => setVerdicts(prev => ({ ...prev, [id]: v }))} onComment={(id, text) => setComments(prev => ({ ...prev, [id]: text }))}
      setStep={setStep} onClose={() => setOpenKey(null)} onSubmit={() => { setSubmitted(prev => ({ ...prev, [active.key]: true })); setOpenKey(null); }} />}
  </div>;
}
