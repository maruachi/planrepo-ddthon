import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ArtifactView } from '@/src/contracts/views';
import {
  parsePlanVisualization,
  type PlanVisualization,
  type PlanVisualizationEvidence,
  type PlanVisualizationEdge,
  type PlanVisualizationNode,
  type PlanVisualizationScenario,
} from '../state/plan-visualization';
import {
  documentSection,
  INCEPTION_DOCUMENTS,
  type InceptionDocumentId,
} from '../state/inception-plan';
import './PlanExperience.css';

type ExperienceTab = 'flow' | 'screen' | 'rules';

const TAB_LABELS: readonly { readonly id: ExperienceTab; readonly label: string }[] = [
  { id: 'flow', label: '변화와 동작' },
  { id: 'screen', label: '사용자가 보는 화면' },
  { id: 'rules', label: '지킬 약속과 예외' },
];

const NODE_LABELS: Record<PlanVisualizationNode['kind'], string> = {
  action: '행동',
  condition: '조건',
  result: '결과',
};

const RULE_LABELS: Record<PlanVisualization['rules'][number]['category'], string> = {
  requirement: '요구사항',
  success: '성공 기준',
  exception: '예외',
};

function evidenceDocument(
  artifact: ArtifactView,
  evidence: PlanVisualizationEvidence,
): InceptionDocumentId | undefined {
  return INCEPTION_DOCUMENTS.find((item) =>
    documentSection(artifact, item.id)?.sectionId === evidence.sectionId)?.id;
}

function EvidenceAction({ artifact, evidence, onOpenDocument, compact = false }: {
  readonly artifact: ArtifactView;
  readonly evidence: PlanVisualizationEvidence;
  readonly onOpenDocument: (id: InceptionDocumentId) => void;
  readonly compact?: boolean;
}) {
  const documentId = evidenceDocument(artifact, evidence);
  return <div className={compact ? 'plan-experience__evidence plan-experience__evidence--compact' : 'plan-experience__evidence'}>
    <blockquote>{evidence.quote}</blockquote>
    <button type="button" className="text-button" onClick={() => onOpenDocument(documentId ?? 'requirements')}>
      {documentId === undefined ? 'Plan 원문 열기' : '문서에서 보기'}
    </button>
  </div>;
}

function ScenarioPicker({ scenarios, selectedId, onSelect }: {
  readonly scenarios: readonly PlanVisualizationScenario[];
  readonly selectedId: string | undefined;
  readonly onSelect: (scenario: PlanVisualizationScenario) => void;
}) {
  if (scenarios.length === 0) return null;
  return <div className="plan-experience__scenario-picker" aria-label="살펴볼 상황">
    {scenarios.map((scenario) => <button type="button" key={scenario.id}
      aria-pressed={scenario.id === selectedId} onClick={() => onSelect(scenario)}>{scenario.label}</button>)}
  </div>;
}

function ScreenPreview({ scenario, onExplain }: {
  readonly scenario: PlanVisualizationScenario | undefined;
  readonly onExplain: () => void;
}) {
  if (scenario === undefined) {
    return <div className="plan-experience__screen-empty"><p>Plan에 화면으로 설명할 상황이 아직 없습니다.</p></div>;
  }
  if (scenario.screen === undefined) {
    return <div className="plan-experience__screen-empty"><strong>{scenario.label}</strong>
      <p>{scenario.description}</p><p className="quiet">이 상황의 화면 내용은 Plan에 따로 적혀 있지 않습니다.</p></div>;
  }
  return <div className="plan-experience__phone" aria-label={scenario.screen.title}>
    <div className="plan-experience__phone-bar"><span /><span /><span /></div>
    <div className="plan-experience__phone-content">
      {scenario.screen.status !== undefined && <span className="plan-experience__screen-status">{scenario.screen.status}</span>}
      <h4>{scenario.screen.title}</h4>
      <p>{scenario.screen.body}</p>
      {scenario.screen.primaryAction !== undefined && <button type="button" onClick={onExplain}>{scenario.screen.primaryAction}</button>}
    </div>
  </div>;
}

function Changes({ visualization, artifact, onOpenDocument }: {
  readonly visualization: PlanVisualization;
  readonly artifact: ArtifactView;
  readonly onOpenDocument: (id: InceptionDocumentId) => void;
}) {
  return <section className="plan-experience__changes" aria-labelledby="plan-change-title">
    <div className="plan-experience__section-heading"><div><p className="eyebrow">한눈에 비교</p><h3 id="plan-change-title">{visualization.overview.headline}</h3></div>
      <EvidenceAction artifact={artifact} evidence={visualization.overview.evidence} onOpenDocument={onOpenDocument} compact /></div>
    <p>{visualization.overview.summary}</p>
    <div className="plan-experience__change-grid">
      <article><span>이전</span>{visualization.changes.before.length > 0
        ? <ul>{visualization.changes.before.map((item, index) => <li key={index}>{item}</li>)}</ul>
        : <p className="quiet">Plan에 이전 상태가 따로 적혀 있지 않습니다.</p>}</article>
      <article><span>이후</span>{visualization.changes.after.length > 0
        ? <ul>{visualization.changes.after.map((item, index) => <li key={index}>{item}</li>)}</ul>
        : <p className="quiet">Plan에 이후 상태가 따로 적혀 있지 않습니다.</p>}</article>
    </div>
    <EvidenceAction artifact={artifact} evidence={visualization.changes.evidence} onOpenDocument={onOpenDocument} compact />
  </section>;
}

function NodeDetail({ node, artifact, onOpenDocument }: {
  readonly node: PlanVisualizationNode | undefined;
  readonly artifact: ArtifactView;
  readonly onOpenDocument: (id: InceptionDocumentId) => void;
}) {
  return <aside className="plan-experience__detail" aria-live="polite">
    {node === undefined ? <p className="quiet">동작을 선택하면 Plan에 적힌 설명과 근거를 보여줍니다.</p> : <>
      <span className="plan-experience__node-kind" data-kind={node.kind}>{NODE_LABELS[node.kind]}</span>
      <h3>{node.title}</h3><p>{node.detail}</p>
      <EvidenceAction artifact={artifact} evidence={node.evidence} onOpenDocument={onOpenDocument} />
    </>}
  </aside>;
}

const FLOW_NODE_WIDTH = 220;
const FLOW_NODE_HEIGHT = 132;
const FLOW_COLUMN_GAP = 156;
const FLOW_ROW_GAP = 34;
const FLOW_PADDING = 24;

interface FlowPosition {
  readonly x: number;
  readonly y: number;
}

interface FlowLayout {
  readonly positions: ReadonlyMap<string, FlowPosition>;
  readonly width: number;
  readonly height: number;
  readonly cyclicNodeIds: ReadonlySet<string>;
}

function layoutFlow(
  nodes: readonly PlanVisualizationNode[],
  edges: readonly PlanVisualizationEdge[],
): FlowLayout {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as PlanVisualizationEdge[]]));
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge);
  }
  const canReach = (from: string, target: string, visited: Set<string>): boolean => {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return (outgoing.get(from) ?? []).some((edge) => canReach(edge.to, target, visited));
  };
  const cyclicNodeIds = new Set(nodes.filter((node) =>
    (outgoing.get(node.id) ?? []).some((edge) => canReach(edge.to, node.id, new Set()))).map((node) => node.id));
  const incoming = new Map(nodes.filter((node) => !cyclicNodeIds.has(node.id)).map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!cyclicNodeIds.has(edge.from) && !cyclicNodeIds.has(edge.to)) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }
  }
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => !cyclicNodeIds.has(node.id) && incoming.get(node.id) === 0);
  const placed = new Set<string>();
  while (queue.length > 0) {
    queue.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    const node = queue.shift()!;
    placed.add(node.id);
    for (const edge of (outgoing.get(node.id) ?? []).filter((item) => !cyclicNodeIds.has(item.to))) {
      depth.set(edge.to, Math.max(depth.get(edge.to) ?? 0, (depth.get(node.id) ?? 0) + 1));
      const nextIncoming = (incoming.get(edge.to) ?? 1) - 1;
      incoming.set(edge.to, nextIncoming);
      if (nextIncoming === 0) queue.push(nodes[order.get(edge.to)!]!);
    }
  }
  const cyclicNodes = nodes.filter((node) => cyclicNodeIds.has(node.id));
  const acyclicDepths = nodes.filter((node) => placed.has(node.id)).map((node) => depth.get(node.id) ?? 0);
  const cycleDepth = (acyclicDepths.length > 0 ? Math.max(...acyclicDepths) : -1) + 1;
  for (const node of cyclicNodes) depth.set(node.id, cycleDepth);

  const columns = new Map<number, PlanVisualizationNode[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    const entries = columns.get(column) ?? [];
    entries.push(node);
    columns.set(column, entries);
  }
  const positions = new Map<string, FlowPosition>();
  for (const [column, entries] of columns) {
    entries.forEach((node, row) => positions.set(node.id, {
      x: FLOW_PADDING + column * (FLOW_NODE_WIDTH + FLOW_COLUMN_GAP),
      y: FLOW_PADDING + row * (FLOW_NODE_HEIGHT + FLOW_ROW_GAP),
    }));
  }
  const maxColumn = Math.max(0, ...columns.keys());
  const maxRows = Math.max(1, ...[...columns.values()].map((entries) => entries.length));
  return {
    positions,
    width: FLOW_PADDING * 2 + (maxColumn + 1) * FLOW_NODE_WIDTH + (maxColumn + 1) * FLOW_COLUMN_GAP,
    height: FLOW_PADDING * 2 + maxRows * FLOW_NODE_HEIGHT + (maxRows - 1) * FLOW_ROW_GAP,
    cyclicNodeIds,
  };
}

function edgePath(from: FlowPosition, to: FlowPosition) {
  const forward = to.x > from.x;
  if (forward) {
    const startX = from.x + FLOW_NODE_WIDTH;
    const endX = to.x;
    const startY = from.y + FLOW_NODE_HEIGHT / 2;
    const endY = to.y + FLOW_NODE_HEIGHT / 2;
    const middleX = (startX + endX) / 2;
    return {
      d: `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`,
      labelX: middleX,
      labelY: (startY + endY) / 2,
    };
  }
  const startX = from.x + FLOW_NODE_WIDTH;
  const endX = to.x + FLOW_NODE_WIDTH;
  const startY = from.y + FLOW_NODE_HEIGHT / 2;
  const endY = to.y + FLOW_NODE_HEIGHT / 2;
  const outsideX = Math.max(startX, endX) + FLOW_COLUMN_GAP * .55;
  return {
    d: `M ${startX} ${startY} C ${outsideX} ${startY}, ${outsideX} ${endY}, ${endX} ${endY}`,
    labelX: outsideX,
    labelY: (startY + endY) / 2,
  };
}

function FlowCanvas({ nodes, edges, highlightedNodes, selectedNodeId, onSelectNode }: {
  readonly nodes: readonly PlanVisualizationNode[];
  readonly edges: readonly PlanVisualizationEdge[];
  readonly highlightedNodes: ReadonlySet<string>;
  readonly selectedNodeId: string | undefined;
  readonly onSelectNode: (nodeId: string) => void;
}) {
  const markerId = useId().replace(/:/gu, '');
  const layout = useMemo(() => layoutFlow(nodes, edges), [nodes, edges]);
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [fit, setFit] = useState(true);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setAvailableWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const scale = fit && availableWidth >= 600 ? Math.min(1, availableWidth / layout.width) : 1;
  return <div><div className="plan-experience__canvas-controls"><p>상황을 선택하고 동작을 눌러 문서의 설명을 읽습니다.</p><button type="button" onClick={() => setFit(value => !value)}>{fit ? '크게 보기' : '전체 흐름 맞춤'}</button></div>
    <div ref={container} className="plan-experience__canvas-scroll" tabIndex={0} aria-label="Plan에 명시된 동작 연결">
    <div style={{ width: layout.width * scale, height: layout.height * scale }}>
    <div className="plan-experience__canvas" style={{ width: layout.width, height: layout.height, transform: 'scale(' + scale + ')', transformOrigin: 'top left' }}>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
        {edges.map((edge, index) => {
          const from = layout.positions.get(edge.from);
          const to = layout.positions.get(edge.to);
          if (from === undefined || to === undefined) return null;
          const geometry = edgePath(from, to);
          const highlighted = highlightedNodes.has(edge.from) && highlightedNodes.has(edge.to);
          return <g key={edge.from + ':' + edge.to + ':' + index} data-highlighted={highlighted}>
            <path className="plan-experience__edge-path" d={geometry.d} markerEnd={'url(#' + markerId + ')'} />
            <foreignObject x={geometry.labelX - 66} y={geometry.labelY - 18} width="132" height="36">
              <div className="plan-experience__edge-label" title={edge.label}>{edge.label}</div>
            </foreignObject>
          </g>;
        })}
      </svg>
      {nodes.map((node, index) => {
        const position = layout.positions.get(node.id);
        if (position === undefined) return null;
        return <button type="button" key={node.id} className="plan-experience__node"
          style={{ left: position.x, top: position.y }} data-kind={node.kind}
          data-highlighted={highlightedNodes.has(node.id)} aria-pressed={node.id === selectedNodeId}
          onClick={() => onSelectNode(node.id)}>
          <span><b>{String(index + 1).padStart(2, '0')}</b>{NODE_LABELS[node.kind]}</span>
          <strong>{node.title}</strong><small>{node.detail}</small>
          {layout.cyclicNodeIds.has(node.id) && <i>순환 연결 포함</i>}
        </button>;
      })}
    </div>
    </div></div>
    <p className="quiet plan-experience__canvas-note">넓은 흐름은 좌우로 움직여 볼 수 있습니다. 번호는 문서의 항목 순서입니다.</p>
  </div>;
}

export function PlanExperience({ artifact, onOpenDocument, onReview, approved }: {
  readonly artifact: ArtifactView;
  readonly onOpenDocument: (id: InceptionDocumentId) => void;
  readonly onReview: () => void;
  readonly approved: boolean;
}) {
  const parsed = useMemo(() => parsePlanVisualization(artifact), [artifact]);
  const parsedVisualization = parsed.kind === 'ready' ? parsed.value : undefined;
  const [tab, setTab] = useState<ExperienceTab>('flow');
  const [scenarioId, setScenarioId] = useState<string>();
  const [nodeId, setNodeId] = useState<string>();
  const [showScreenExplanation, setShowScreenExplanation] = useState(false);
  const artifactKey = artifact.versionRef.entityId + ':' + artifact.versionRef.version;

  useEffect(() => {
    const firstScenario = parsedVisualization?.scenarios[0];
    setScenarioId(firstScenario?.id);
    setNodeId(firstScenario?.nodeIds[0] ?? parsedVisualization?.nodes[0]?.id);
    setShowScreenExplanation(false);
  }, [artifactKey, parsedVisualization]);

  if (parsed.kind === 'absent') return null;
  if (parsed.kind === 'invalid') {
    return <section className="plan-experience plan-experience--invalid" aria-label="Plan 시각화 안내">
      <h2>Plan 내용을 시각화하지 못했습니다.</h2>
      <p>현재 Plan 원문에서 내용을 확인해 주세요.</p>
      <button type="button" onClick={() => onOpenDocument('requirements')}>Plan 원문 열기</button>
    </section>;
  }

  const visualization = parsed.value;
  const selectedScenario = visualization.scenarios.find((item) => item.id === scenarioId) ?? visualization.scenarios[0];
  const selectedNode = visualization.nodes.find((item) => item.id === nodeId);
  const highlightedNodes = new Set(selectedScenario?.nodeIds ?? visualization.nodes.map((node) => node.id));
  const nodeById = new Map(visualization.nodes.map((node) => [node.id, node]));

  const selectScenario = (scenario: PlanVisualizationScenario) => {
    setScenarioId(scenario.id);
    setNodeId(scenario.nodeIds[0]);
    setShowScreenExplanation(false);
  };

  return <section className="plan-experience" aria-label="Plan 내용 시각화">
    <header className="plan-experience__hero">
      <div><p className="eyebrow">현재 Plan으로 보는 경험</p><h2>{visualization.overview.headline}</h2><p>{visualization.overview.summary}</p></div>
      <div className="plan-experience__approval"><span data-approved={approved}>{approved ? '현재 Plan 결재 완료' : '현재 Plan 검토 중'}</span>
        <button type="button" onClick={onReview}>결재 상세</button></div>
    </header>

    <nav className="plan-experience__tabs" role="tablist" aria-label="Plan 시각화 보기">
      {TAB_LABELS.map((item) => <button type="button" role="tab" key={item.id}
        aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </nav>

    {tab === 'flow' && <div role="tabpanel" className="plan-experience__panel">
      <Changes visualization={visualization} artifact={artifact} onOpenDocument={onOpenDocument} />
      <section className="plan-experience__scenario-flow" aria-labelledby="plan-flow-title">
        <div className="plan-experience__section-heading"><div><p className="eyebrow">상황별로 읽기</p><h3 id="plan-flow-title">무슨 일이 일어나는지 살펴보기</h3></div></div>
        <ScenarioPicker scenarios={visualization.scenarios} selectedId={selectedScenario?.id} onSelect={selectScenario} />
        <div className="plan-experience__flow-layout">
          <div>
            <FlowCanvas nodes={visualization.nodes} edges={visualization.edges} highlightedNodes={highlightedNodes}
              selectedNodeId={selectedNode?.id} onSelectNode={setNodeId} />
            {visualization.edges.length > 0 && <details className="plan-experience__edge-evidence">
              <summary>연결된 문장 보기</summary>
              <div>{visualization.edges.map((edge, index) => <article key={edge.from + ':' + edge.to + ':' + index}>
                <p><span>{nodeById.get(edge.from)?.title ?? edge.from}</span><strong> → {edge.label} → </strong><span>{nodeById.get(edge.to)?.title ?? edge.to}</span></p>
                <EvidenceAction artifact={artifact} evidence={edge.evidence} onOpenDocument={onOpenDocument} compact />
              </article>)}</div>
            </details>}
          </div>
          <NodeDetail node={selectedNode} artifact={artifact} onOpenDocument={onOpenDocument} />
        </div>
        {selectedScenario !== undefined && <div className="plan-experience__scenario-result">
          <div><span>선택한 상황</span><h3>{selectedScenario.label}</h3><p>{selectedScenario.description}</p><strong>{selectedScenario.outcome}</strong>
            <EvidenceAction artifact={artifact} evidence={selectedScenario.evidence} onOpenDocument={onOpenDocument} compact /></div>
          <ScreenPreview scenario={selectedScenario} onExplain={() => setShowScreenExplanation(true)} />
        </div>}
        {showScreenExplanation && selectedScenario !== undefined && <div className="plan-experience__simulation-note" role="status">
          <strong>{selectedScenario.label}</strong><p>{selectedScenario.description}</p><p>이 버튼은 Plan에 적힌 화면을 설명합니다. 실제 업무를 실행하지 않습니다.</p>
        </div>}
      </section>
    </div>}

    {tab === 'screen' && <div role="tabpanel" className="plan-experience__panel">
      <div className="plan-experience__section-heading"><div><p className="eyebrow">화면으로 읽기</p><h3>사용자가 보게 될 내용을 확인합니다.</h3></div></div>
      <ScenarioPicker scenarios={visualization.scenarios} selectedId={selectedScenario?.id} onSelect={selectScenario} />
      <div className="plan-experience__screen-layout">
        <ScreenPreview scenario={selectedScenario} onExplain={() => setShowScreenExplanation(true)} />
        <article>{selectedScenario === undefined ? <p className="quiet">화면으로 설명할 상황이 없습니다.</p> : <>
          <span>현재 상황</span><h3>{selectedScenario.label}</h3><p>{selectedScenario.description}</p><strong>{selectedScenario.outcome}</strong>
          {selectedScenario.screen !== undefined && <EvidenceAction artifact={artifact} evidence={selectedScenario.screen.evidence} onOpenDocument={onOpenDocument} />}
          <EvidenceAction artifact={artifact} evidence={selectedScenario.evidence} onOpenDocument={onOpenDocument} />
        </>}</article>
      </div>
      {showScreenExplanation && selectedScenario !== undefined && <div className="plan-experience__simulation-note" role="status">
        <strong>{selectedScenario.label}</strong><p>{selectedScenario.description}</p><p>이 버튼은 Plan에 적힌 화면을 설명합니다. 실제 업무를 실행하지 않습니다.</p>
      </div>}
    </div>}

    {tab === 'rules' && <div role="tabpanel" className="plan-experience__panel">
      <div className="plan-experience__section-heading"><div><p className="eyebrow">계획의 기준</p><h3>지킬 약속과 예외</h3></div></div>
      <div className="plan-experience__rules">{visualization.rules.map((rule) => <article key={rule.id} data-category={rule.category}>
        <span>{RULE_LABELS[rule.category]}</span><h3>{rule.title}</h3><p>{rule.detail}</p>
        <EvidenceAction artifact={artifact} evidence={rule.evidence} onOpenDocument={onOpenDocument} compact />
      </article>)}</div>
      {visualization.rules.length === 0 && <p className="quiet">Plan에 별도 약속이나 예외가 적혀 있지 않습니다.</p>}
      <p className="plan-experience__measurement-note">이 기준은 모두 현재 Plan에 적힌 약속입니다. 실제 운영에서 측정한 결과가 아닙니다.</p>
    </div>}
  </section>;
}
