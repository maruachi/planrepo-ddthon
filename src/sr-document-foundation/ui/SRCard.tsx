import { Link, useNavigate } from 'react-router-dom';
import type { SRSummary } from '../../shared/contracts.js';
import { INCEPTION_REVIEWS } from '../../aidlc-planning/ui/plan-review-data.js';
export function SRCard({ sr }: { sr: SRSummary }) {
  const navigate = useNavigate();
  // 이 SR 에 대응하는 리뷰(아이콘 대상)를 제목으로 찾아, "리뷰 필요" 클릭 시 그 SR 리뷰로 바로 진행시킨다.
  const review = INCEPTION_REVIEWS.find(r => r.hasIcon && r.title === sr.title);
  const goReview = (e: { preventDefault: () => void; stopPropagation: () => void }) => { e.preventDefault(); e.stopPropagation(); navigate(review ? `/plan-review?open=${review.key}` : '/plan-review'); };
  return <Link className="sr-card" draggable data-testid="sr-card-detail-link" onDragStart={e => { e.dataTransfer.setData('text/sr-id', sr.id); e.dataTransfer.setData('text/sr-column', sr.column); e.dataTransfer.effectAllowed = 'move'; }} to={`/srs/${sr.id}`}>
    {review && <span className="sr-card-review" role="button" tabIndex={0} data-testid="sr-card-review-icon" title="이 SR 의 Plan 리뷰 진행" onClick={goReview} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') goReview(e); }}><span className="sr-card-review-bang" aria-hidden="true">!</span>리뷰 필요</span>}
    <span className="card-id">SR · {sr.id.slice(0, 8)}</span>
    <h3>{sr.title}</h3>
    <div className="card-badges">{(sr.column === 'inception' || sr.column === 'construction') && <span className="badge badge-version">v{(sr.column === 'inception' ? sr.inceptionCycle : sr.constructionCycle) || 1}</span>}{sr.planningStatus === 'running' && <span className="badge">생성 중</span>}{sr.planningStatus === 'failed' && <span className="badge">생성 실패</span>}{!!sr.pendingReviews && <span className="badge" data-testid="sr-card-review-status">리뷰 대기 {sr.pendingReviews}건</span>}{sr.column === 'implemented' && <span className="badge badge-done">완료</span>}</div>
    <div className="card-bottom"><time>{new Date(sr.createdAt).toLocaleDateString('ko-KR')}</time><span aria-hidden="true">↗</span></div>
  </Link>;
}
