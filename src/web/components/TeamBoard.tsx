import { useEffect, useState } from 'react';
import type { BoardCardView, BoardView, SRDetailView } from '@/src/contracts/views';
import { invoke } from '../api/client';
import { currentPlan, excerpt, PLAN_STATES, planState } from '../state/inception-plan';

function Card({ card, detail, actorName, onOpen }: {
  readonly card: BoardCardView; readonly detail: SRDetailView | undefined; readonly actorName: string;
  onOpen(srId: string, tab?: string): void;
}) {
  const state = detail ? planState(detail) : 'draft';
  const status = PLAN_STATES.find(s => s.id === state)!;
  const artifact = detail && currentPlan(detail);
  const review = state === 'review' || state === 'changes';
  const targetTab = review ? 'approval' : state === 'approved' ? 'overview' : 'documents';
  const action = review
    ? '문서 검토 이어가기'
    : state === 'approved'
      ? '승인된 Plan 개요 보기'
      : artifact === undefined
        ? '초안 문서 작성하기'
        : 'Plan 문서 이어서 작성';
  return <article className="sr-card">
    <span className="sr-key">{card.sr.key}</span><h3>{card.sr.title}</h3>
    <p className="card-meta">담당자 {actorName}{artifact ? ' · 문서 v' + artifact.versionRef.version : ''}</p>
    <p>{detail ? excerpt(detail.currentDescription.description, 95) : '상세 내용을 열어 확인해 주세요.'}</p>
    <div className="card-next"><p>{detail ? status.help : 'Plan 상태를 아직 확인하지 못했습니다.'}</p></div>
    <button className="text-button" type="button" onClick={() => onOpen(card.sr.scope.srId, targetTab)}>
      {action}
    </button>
  </article>;
}
export function TeamBoard({ actorId, projectId, board, loading, actorName, onOpen, onRegister }: {
  readonly actorId: string; readonly projectId: string; readonly board: BoardView | undefined;
  readonly loading: boolean; readonly actorName: (actorId: string) => string;
  onOpen(srId: string, tab?: string): void; onRegister(): void;
}) {
  const [details, setDetails] = useState<ReadonlyMap<string, SRDetailView>>(new Map());
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setDetails(new Map()); setChecking(true); setFailed(false);
    if (!board) return () => { active = false; };
    void Promise.allSettled(board.cards.map(async card => {
      const srId = card.sr.scope.srId;
      const result = await invoke('M-047', { actorId, projectId, srId }, {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    })).then(results => {
      if (!active) return;
      setDetails(new Map(results.flatMap(r => r.status === 'fulfilled' ? [[r.value.sr.scope.srId, r.value] as const] : [])));
      setFailed(results.some(r => r.status === 'rejected')); setChecking(false);
    });
    return () => { active = false; };
  }, [actorId, projectId, board, reload]);
  const pendingCards = board?.cards.filter(card => !details.has(card.sr.scope.srId)) ?? [];
  return <section aria-labelledby="team-board-title">
    <div className="prototype-intro"><div><p className="eyebrow">Plan 중심의 협업</p><h2 id="team-board-title">Plan 보드</h2>
      <p>SR과 초안 문서를 등록합니다. Inception 문서를 하나의 Plan으로 모아 공유하고, 코드 작성 전에 함께 검토합니다.</p>
    </div><button className="primary-button" type="button" data-testid="board-create-button" onClick={onRegister}>＋ 초안 문서로 시작</button></div>
    {(loading || checking) && <p role="status">Plan 상태를 확인하고 있습니다.</p>}
    {failed && <div className="page-error" role="alert"><p>일부 Plan 상태를 불러오지 못했습니다.</p><button onClick={() => setReload(v => v + 1)}>다시 확인</button></div>}
    {!loading && board?.cards.length === 0 && <p className="empty-state">가지고 있는 초안으로 첫 SR을 작성해 보십시오.</p>}
    <div className="inception-board kanban-board" tabIndex={0} aria-label="Plan 상태별 목록">
      {PLAN_STATES.map(status => {
        const cards = board?.cards.filter(card => { const detail = details.get(card.sr.scope.srId); return detail && planState(detail) === status.id; }) ?? [];
        return <section className="kanban-column" key={status.id} aria-label={status.label}>
          <header><h3>{status.label}</h3><span>{cards.length}</span></header>
          <p className="kanban-help">{status.help}</p>
          {cards.length === 0 ? <p className="kanban-empty">이 상태의 Plan이 없습니다.</p> : cards.map(card => <Card key={card.sr.scope.srId} card={card} detail={details.get(card.sr.scope.srId)} actorName={actorName(card.sr.ownerId)} onOpen={onOpen} />)}
        </section>;
      })}
    </div>
    {!checking && pendingCards.length > 0 && <section><h3>상태 확인 필요</h3><div className="board-grid">{pendingCards.map(card => <Card key={card.sr.scope.srId} card={card} detail={undefined} actorName={actorName(card.sr.ownerId)} onOpen={onOpen} />)}</div></section>}
    {board?.truncated === true && <p className="notice">일부 요청만 표시하고 있습니다.</p>}
  </section>;
}
