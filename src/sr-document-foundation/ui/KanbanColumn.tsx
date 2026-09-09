import { useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SRSummary } from '../../shared/contracts.js';
import type { Column } from '../../shared/limits.js';
import { SRCard } from './SRCard.js';
export function KanbanColumn({ column, label, cards }: { column: Column; label: string; cards: SRSummary[] }) {
  const navigate = useNavigate();
  const [over, setOver] = useState(false);
  // 다른 단계 컬럼으로 카드를 끌어다 놓으면 실제 이동 대신 그 SR 상세로 보낸다(대기 질문이 있으면 모달이 자동으로 열림).
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const id = e.dataTransfer.getData('text/sr-id');
    const from = e.dataTransfer.getData('text/sr-column');
    if (id && from !== column) navigate(`/srs/${id}`);
  };
  return <section className={`kanban-column column-${column}${over ? ' drop-over' : ''}`} aria-label={label}
    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
    onDrop={onDrop}>
    <h2><span className="column-dot"/>{label}<span className="count">{cards.length}</span></h2>
    <div className="column-cards">{cards.map(sr => <SRCard key={sr.id} sr={sr} />)}{!cards.length && <p className="column-empty">아직 SR이 없습니다</p>}</div>
  </section>;
}
