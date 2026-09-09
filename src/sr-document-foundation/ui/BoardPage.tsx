import { useState } from 'react';
import type { AppError, SRSummary } from '../../shared/contracts.js';
import { isSRSummary } from '../../shared/client/api-client.js';
import { errorOf } from '../../shared/errors.js';
import { adjacentColumn, COLUMNS, type BoardMoveDirection } from '../../shared/limits.js';
import { usePaged } from './use-query.js';
import { KanbanColumn } from './KanbanColumn.js';
import { SRCreateForm } from './SRCreateForm.js';
import { ErrorNotice } from './ErrorNotice.js';
import { AsyncStatus } from './AsyncStatus.js';
import { Pagination } from './Pagination.js';
import { boardClient } from './board-client.js';
export function BoardPage() {
  const [create, setCreate] = useState(false); const board = usePaged('/api/board', isSRSummary);
  const [moving, setMoving] = useState<string>(); const [moveError, setMoveError] = useState<AppError>();
  const [failedMove, setFailedMove] = useState<{ sr: SRSummary; direction: BoardMoveDirection; operationId: string }>();
  const move = async (sr: SRSummary, direction: BoardMoveDirection, operationId: string = crypto.randomUUID()) => {
    const target = adjacentColumn(sr.column, direction); if (!target || moving) return;
    setMoving(sr.id); setMoveError(undefined);
    try { await boardClient.move(sr.id, sr.column, target, operationId); setFailedMove(undefined); board.reload(); }
    catch (error) { setMoveError(errorOf(error)); setFailedMove({ sr, direction, operationId }); }
    finally { setMoving(undefined); }
  };
  return <div className="board-page"><div className="page-heading"><div><p className="eyebrow">WORKSPACE / BOARD</p><h1>계획 보드</h1><p className="subtitle">요구사항부터 구현 준비까지, SR의 흐름을 확인하세요.</p></div><button className="primary" data-testid="board-create-button" onClick={() => setCreate(v => !v)} aria-expanded={create}>＋ 새 SR 만들기</button></div>{create && <SRCreateForm close={() => setCreate(false)} />}<div className="board-toolbar"><span className="active-tab">모든 SR <b>{board.data?.items.length ?? 0}</b></span><button className="quiet" data-testid="board-refresh-button" disabled={board.loading} onClick={board.reload}>↻ 새로고침</button></div><ErrorNotice error={board.error} retry={board.reload} />{moveError && <div className="notice error" role="alert"><p>{moveError.message}</p>{failedMove && <button data-testid="board-move-retry-button" disabled={!!moving} onClick={() => void move(failedMove.sr, failedMove.direction, failedMove.operationId)}>다시 시도</button>}</div>}<AsyncStatus loading={board.loading} /><div className="board-scroll" tabIndex={0} aria-label="SR 계획 보드"><div className="kanban">{COLUMNS.map(([key, label]) => <KanbanColumn key={key} column={key} label={label} cards={(board.data?.items ?? []).filter(s => s.column === key)} moving={moving} move={move} />)}</div></div>{board.data && <Pagination count={board.data.items.length} hasMore={!!board.data.nextCursor} loading={board.loading} more={() => void board.more()} />}<div className="board-note"><span>01 — 06</span><p>SR을 만들고, 계획 문서의 변화를 기록하세요.</p></div></div>;
}
