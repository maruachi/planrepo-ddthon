import { useId, useState } from 'react';
import type { SRDetailView } from '@/src/contracts/views';
import { currentPlan, documentSection, excerpt, INCEPTION_DOCUMENTS, isInceptionPlan, planState, planStateLabel, sectionBody, structuralLinks, type InceptionDocumentId } from '../state/inception-plan';
import { PlanDocumentVisual } from './PlanDocumentVisual';
import { PlanExperience } from './PlanExperience';
import { parsePlanVisualization } from '../state/plan-visualization';

export function StructureMap({ markdown, onOpen }: { markdown: string; onOpen(): void }) {
  const marker = useId().replace(/:/gu, '');
  const links = structuralLinks(markdown);
  const names = [...new Set(links.flatMap(l => [l.from, l.to]))];
  const displayed = names.slice(0, 12);
  const positions = new Map(displayed.map((name, i) => [name, { x: 20 + (i % 3) * 238, y: 28 + Math.floor(i / 3) * 120 }]));
  const height = Math.max(130, Math.ceil(displayed.length / 3) * 120);
  return <section className="plan-summary-card plan-structure"><header><h3>주요 구조</h3><button className="text-button" onClick={onOpen}>문서에서 보기</button></header>
    {displayed.length > 0 ? <>
      <svg viewBox={'0 0 730 ' + height} role="img" aria-label="Plan 문서에 적힌 구성 요소 연결">
        <title>주요 구성 요소와 연결</title><desc>문서에 명시된 연결을 표시합니다. 아래 목록에서도 같은 관계를 읽을 수 있습니다.</desc>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#6e8a79" /></marker></defs>
        {links.map((l, i) => {
          const a = positions.get(l.from), b = positions.get(l.to);
          if (!a || !b) return null;
          const forward = a.x < b.x;
          const path = a.y === b.y
            ? 'M ' + (forward ? a.x + 190 : a.x) + ' ' + (a.y + 35) + ' L ' + (forward ? b.x : b.x + 190) + ' ' + (b.y + 35)
            : 'M ' + (a.x + 95) + ' ' + (a.y < b.y ? a.y + 70 : a.y) + ' L ' + (a.x + 95) + ' ' + ((a.y + b.y + 70) / 2) + ' L ' + (b.x + 95) + ' ' + ((a.y + b.y + 70) / 2) + ' L ' + (b.x + 95) + ' ' + (a.y < b.y ? b.y : b.y + 70);
          return <path key={i} d={path} fill="none" stroke="#6e8a79" strokeWidth="2" markerEnd={'url(#' + marker + ')'} />;
        })}
        {displayed.map(name => { const p = positions.get(name)!; const parts = [name.slice(0, 14), name.slice(14, 28), name.slice(28)]; return <g key={name}><rect x={p.x} y={p.y} width="190" height="70" rx="10" fill="#edf5ef" stroke="#92b19d" /><text x={p.x + 95} y={p.y + (parts[1] ? 25 : 41)} textAnchor="middle" fill="#244833" fontSize="15">{parts.filter(Boolean).map((part, i) => <tspan x={p.x + 95} dy={i === 0 ? 0 : 18} key={i}>{part}</tspan>)}</text></g>; })}
      </svg>
      {names.length > displayed.length && <p className="quiet">전체 구성 요소는 문서에서 확인합니다.</p>}
      <details><summary>연결 관계를 글로 보기</summary><ul>{links.map((l, i) => <li key={i}>{l.from}에서 {l.to}로 연결합니다.</li>)}</ul></details>
    </> : <p>{markdown ? excerpt(markdown, 280) : '주요 구조를 정리하면 이곳에 구성 요소와 연결을 보여줍니다.'}</p>}
  </section>;
}
export function PlanOverview({ detail, actorName, onOpenDocument, onDiscuss, onReview, readOnly = false }: {
  detail: SRDetailView; actorName(id: string): string; onOpenDocument(id: InceptionDocumentId): void; onDiscuss(): void; onReview(): void; readOnly?: boolean;
}) {
  const artifact = currentPlan(detail);
  const [visualDocument, setVisualDocument] = useState<InceptionDocumentId>('structure');
  const plan = isInceptionPlan(artifact);
  const visualization = artifact && plan ? parsePlanVisualization(artifact) : { kind: 'absent' as const };
  const section = (id: InceptionDocumentId) => { const value = documentSection(artifact, id); return artifact && value ? sectionBody(artifact, value.sectionId) : ''; };
  const structure = section('structure');
  const suggestions = detail.questions.filter(q => q.currentClassification.scope === 'current' && q.currentClassification.requiredGate === 'G1' && q.status === 'open');
  const presentDocuments = INCEPTION_DOCUMENTS.filter(d => documentSection(artifact, d.id) !== undefined);
  const selectedDocument = presentDocuments.find(d => d.id === visualDocument) ?? presentDocuments[0];
  const config = detail.reviewConfigurations.find(c => c.gate === 'G1');
  return <div className="plan-overview">
    {visualization.kind === 'ready' && artifact ? <PlanExperience artifact={artifact} onOpenDocument={onOpenDocument} onReview={onReview} approved={planState(detail) === 'approved'} />
      : <section className="plan-intent"><p className="eyebrow">문서 요약</p><h2>{detail.sr.title}</h2><p>{excerpt(artifact?.markdown ?? detail.currentDescription.description, 480)}</p><div className="plan-intent-actions"><button className="primary-button" onClick={() => onOpenDocument('requirements')}>문서 읽기</button>{!readOnly && <button onClick={onDiscuss}>AI로 요약·시각화 제안받기</button>}<button onClick={onReview}>공유·리뷰</button></div><p className="quiet">{readOnly ? '승인된 문서에 별도 시각화가 포함되지 않았습니다. 현재 승인 범위는 문서 내용입니다.' : '필요한 요약과 시각화는 결재 전에 문서와 함께 확인합니다. 문서만으로도 리뷰를 요청할 수 있습니다.'}</p>{visualization.kind === 'invalid' && <p className="quiet">이 버전의 시각화는 다시 정리가 필요합니다. 문서는 그대로 읽고 리뷰할 수 있습니다.</p>}</section>}
    <div className="plan-metrics"><div><span>현재 상태</span><strong>{planStateLabel(detail)}</strong></div><div><span>문서 버전</span><strong>{plan ? 'v' + artifact!.versionRef.version : '초안 등록 전'}</strong></div><div><span>함께 검토할 사람</span><strong>{config?.assignment?.reviewerIds.map(actorName).join(', ') || '검토 요청할 때 선택합니다'}</strong></div></div>
    {presentDocuments.length > 0 && <section className="plan-summary-card"><header><div><h3>문서에 담긴 내용</h3><p className="quiet">현재 문서의 내용을 모아 보여줍니다.</p></div></header><div className="plan-document-map">{presentDocuments.map(d => {
      const body = section(d.id);
      return <button key={d.id} onClick={() => onOpenDocument(d.id)}><strong>{d.title}</strong><p>{excerpt(body, 160)}</p><small>문서에서 보기</small></button>;
    })}</div></section>}
    {selectedDocument && <section className="plan-visuals" aria-label="내용별 요약"><h3>내용별로 살펴보기</h3>
      <nav className="plan-visual-selector" aria-label="살펴볼 내용">{presentDocuments.map(d => <button key={d.id} aria-pressed={selectedDocument.id === d.id} onClick={() => setVisualDocument(d.id)}>{d.title}</button>)}</nav>
      {selectedDocument.id === 'structure' ? <StructureMap markdown={structure} onOpen={() => onOpenDocument('structure')} />
        : artifact ? <PlanDocumentVisual artifact={artifact} documentId={selectedDocument.id} onRead={() => onOpenDocument(selectedDocument.id)} /> : null}
    </section>}
    {!readOnly && suggestions.length > 0 && <details className="plan-summary-card"><summary>AI가 추천한 확인할 내용 · 선택 사항</summary><p className="quiet">문서를 다듬을 때 참고하세요. 별도의 답변이나 확인 기록을 모두 작성할 필요는 없습니다.</p><ul>{suggestions.map(q => <li key={q.questionId}>{q.text}</li>)}</ul><button onClick={onDiscuss}>AI와 문서 보완</button></details>}
  </div>;
}
