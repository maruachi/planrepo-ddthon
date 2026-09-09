import type { SRSummary } from '../../shared/contracts.js';
import type { Column } from '../../shared/limits.js';
import { SRCard } from './SRCard.js';
export function KanbanColumn({ column, label, cards }: { column: Column; label: string; cards: SRSummary[] }) { return <section className={`kanban-column column-${column}`} aria-label={label}><h2><span className="column-dot"/>{label}<span className="count">{cards.length}</span></h2><div className="column-cards">{cards.map(sr => <SRCard key={sr.id} sr={sr} />)}{!cards.length && <p className="column-empty">아직 SR이 없습니다</p>}</div></section>; }
