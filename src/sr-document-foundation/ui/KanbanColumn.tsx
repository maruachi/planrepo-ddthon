import type { SRSummary } from '../../shared/contracts.js';
import type { BoardMoveDirection, Column } from '../../shared/limits.js';
import { SRCard } from './SRCard.js';
export function KanbanColumn({ column, label, cards, moving, move }: { column: Column; label: string; cards: SRSummary[]; moving?: string; move: (sr: SRSummary, direction: BoardMoveDirection) => Promise<void> }) { return <section className={`kanban-column column-${column}`} aria-label={label}><h2><span className="column-dot"/>{label}<span className="count">{cards.length}</span></h2><div className="column-cards">{cards.map(sr => <SRCard key={sr.id} sr={sr} moving={moving === sr.id} move={move} />)}{!cards.length && <p className="column-empty">아직 SR이 없습니다</p>}</div></section>; }
