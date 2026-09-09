import { useState } from 'react';
import type { SRSummary } from '../../shared/contracts.js';
import { record } from '../../shared/client/api-client.js';
import { COLUMNS } from '../../shared/limits.js';
import { usePaged } from './use-query.js';
import { KanbanColumn } from './KanbanColumn.js';
import { SRCreateForm } from './SRCreateForm.js';
import { ErrorNotice } from './ErrorNotice.js';
import { AsyncStatus } from './AsyncStatus.js';
import { Pagination } from './Pagination.js';
const isSummary = (x: unknown): x is SRSummary => record(x) && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.createdAt === 'string' && COLUMNS.some(([key]) => key === x.column);
export function BoardPage() {
  const [create, setCreate] = useState(false); const board = usePaged('/api/board', isSummary);
  return <div className="board-page"><div className="board-toolbar"><span className="active-tab">모든 SR <b>{board.data?.items.length ?? 0}</b></span><div className="board-toolbar-actions"><button className="quiet" data-testid="board-refresh-button" disabled={board.loading} onClick={board.reload}>↻ 새로고침</button><button className="primary board-create-btn" data-testid="board-create-button" onClick={() => setCreate(v => !v)} aria-expanded={create}>＋ 새 SR 만들기</button></div></div>{create && <SRCreateForm close={() => setCreate(false)} />}<ErrorNotice error={board.error} retry={board.reload} /><AsyncStatus loading={board.loading} /><div className="board-scroll" tabIndex={0} aria-label="SR 계획 보드"><div className="kanban">{COLUMNS.map(([key, label]) => <KanbanColumn key={key} column={key} label={label} cards={(board.data?.items ?? []).filter(s => s.column === key)} />)}</div></div>{board.data && <Pagination count={board.data.items.length} hasMore={!!board.data.nextCursor} loading={board.loading} more={() => void board.more()} />}</div>;
}
