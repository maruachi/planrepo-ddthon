import type { ArtifactView } from '@/src/contracts/views';

export interface PlanVisualizationEvidence {
  readonly sectionId: string;
  readonly quote: string;
}

export interface PlanVisualizationOverview {
  readonly headline: string;
  readonly summary: string;
  readonly evidence: PlanVisualizationEvidence;
}

export interface PlanVisualizationChanges {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly evidence: PlanVisualizationEvidence;
}

export interface PlanVisualizationNode {
  readonly id: string;
  readonly kind: 'action' | 'condition' | 'result';
  readonly title: string;
  readonly detail: string;
  readonly evidence: PlanVisualizationEvidence;
}

export interface PlanVisualizationEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly evidence: PlanVisualizationEvidence;
}

export interface PlanVisualizationScreen {
  readonly title: string;
  readonly body: string;
  readonly status?: string;
  readonly primaryAction?: string;
  readonly evidence: PlanVisualizationEvidence;
}

export interface PlanVisualizationScenario {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly nodeIds: readonly string[];
  readonly outcome: string;
  readonly evidence: PlanVisualizationEvidence;
  readonly screen?: PlanVisualizationScreen;
}

export interface PlanVisualizationRule {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly category: 'requirement' | 'success' | 'exception';
  readonly evidence: PlanVisualizationEvidence;
}

export interface PlanVisualization {
  readonly schemaVersion: 1;
  readonly overview: PlanVisualizationOverview;
  readonly changes: PlanVisualizationChanges;
  readonly nodes: readonly PlanVisualizationNode[];
  readonly edges: readonly PlanVisualizationEdge[];
  readonly scenarios: readonly PlanVisualizationScenario[];
  readonly rules: readonly PlanVisualizationRule[];
}

export type PlanVisualizationParseResult =
  | { readonly kind: 'ready'; readonly value: PlanVisualization }
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly message: string };

const OPEN_MARKER = '<!-- planrepo-visualization';
const COMMENT_PATTERN = /<!-- planrepo-visualization\r?\n([\s\S]*?)\r?\n-->/g;
const HIDDEN_COMMENT_PATTERN = /<!-- planrepo-visualization[\s\S]*?-->/g;
const MAX_COMMENT_BYTES = 64 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_SECTION_ID_LENGTH = 256;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_TEXT_LENGTH = 8_192;
const MAX_EVIDENCE_QUOTE_LENGTH = 2_048;
const MAX_CHANGE_ITEMS = 12;
const MAX_NODES = 12;
const MAX_EDGES = 18;
const MAX_SCENARIOS = 6;
const MAX_RULES = 12;

interface VisualizationBlock {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly json: string;
}

class InvalidVisualization extends Error {}

function invalid(message: string): PlanVisualizationParseResult {
  return { kind: 'invalid', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))) {
    throw new InvalidVisualization('지원하지 않거나 빠진 필드가 있습니다.');
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidVisualization(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function textValue(
  value: unknown,
  label: string,
  maxLength: number,
  minTrimmedLength = 1,
): string {
  if (typeof value !== 'string' || value.length > maxLength ||
    value.trim().length < minTrimmedLength) {
    throw new InvalidVisualization(`${label} 길이가 올바르지 않습니다.`);
  }
  return value;
}

function arrayValue(value: unknown, label: string, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new InvalidVisualization(`${label} 개수가 허용 범위를 벗어났습니다.`);
  }
  return value;
}

function strings(value: unknown, label: string, maxItems: number): readonly string[] {
  return arrayValue(value, label, maxItems).map((item, index) =>
    textValue(item, `${label}[${index}]`, MAX_TEXT_LENGTH));
}

function countMarker(markdown: string): number {
  let count = 0;
  let from = 0;
  while (from < markdown.length) {
    const index = markdown.indexOf(OPEN_MARKER, from);
    if (index === -1) return count;
    count += 1;
    from = index + OPEN_MARKER.length;
  }
  return count;
}

function visualizationBlocks(markdown: string): readonly VisualizationBlock[] {
  return [...markdown.matchAll(COMMENT_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    source: match[0],
    json: match[1] ?? '',
  }));
}

function sectionSegments(
  artifact: ArtifactView,
  block: VisualizationBlock,
): ReadonlyMap<string, readonly string[]> {
  const sections = new Map<string, readonly string[]>();
  for (const section of artifact.sectionIndex) {
    if (sections.has(section.sectionId) || section.sectionId.length === 0 ||
      section.sectionId.length > MAX_SECTION_ID_LENGTH ||
      !Number.isInteger(section.startOffset) || !Number.isInteger(section.endOffset) ||
      section.startOffset < 0 || section.endOffset < section.startOffset ||
      section.endOffset > artifact.markdown.length) {
      throw new InvalidVisualization('문서 section index가 올바르지 않습니다.');
    }
    const headingEnd = artifact.markdown.indexOf('\n', section.startOffset);
    const bodyStart = headingEnd === -1 || headingEnd >= section.endOffset
      ? section.endOffset
      : headingEnd + 1;
    const ranges: Array<readonly [number, number]> = [];
    if (bodyStart < Math.min(section.endOffset, block.start)) {
      ranges.push([bodyStart, Math.min(section.endOffset, block.start)]);
    }
    if (Math.max(bodyStart, block.end) < section.endOffset) {
      ranges.push([Math.max(bodyStart, block.end), section.endOffset]);
    }
    if (block.end <= bodyStart || block.start >= section.endOffset) {
      ranges.length = 0;
      ranges.push([bodyStart, section.endOffset]);
    }
    sections.set(section.sectionId, ranges.map(([start, end]) => artifact.markdown.slice(start, end)));
  }
  return sections;
}

function evidenceValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationEvidence {
  const evidence = record(value, 'evidence');
  exactKeys(evidence, ['sectionId', 'quote']);
  const sectionId = textValue(evidence.sectionId, 'evidence.sectionId', MAX_SECTION_ID_LENGTH);
  const quote = textValue(evidence.quote, 'evidence.quote', MAX_EVIDENCE_QUOTE_LENGTH, 4);
  const segments = sections.get(sectionId);
  if (segments === undefined) {
    throw new InvalidVisualization('evidence가 현재 문서 section을 가리키지 않습니다.');
  }
  if (!segments.some((segment) => segment.includes(quote))) {
    throw new InvalidVisualization('evidence 인용문을 현재 section 본문에서 찾을 수 없습니다.');
  }
  return { sectionId, quote };
}

function overviewValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationOverview {
  const overview = record(value, 'overview');
  exactKeys(overview, ['headline', 'summary', 'evidence']);
  return {
    headline: textValue(overview.headline, 'overview.headline', MAX_SHORT_TEXT_LENGTH),
    summary: textValue(overview.summary, 'overview.summary', MAX_TEXT_LENGTH),
    evidence: evidenceValue(overview.evidence, sections),
  };
}

function changesValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationChanges {
  const changes = record(value, 'changes');
  exactKeys(changes, ['before', 'after', 'evidence']);
  return {
    before: strings(changes.before, 'changes.before', MAX_CHANGE_ITEMS),
    after: strings(changes.after, 'changes.after', MAX_CHANGE_ITEMS),
    evidence: evidenceValue(changes.evidence, sections),
  };
}

function nodeValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationNode {
  const node = record(value, 'node');
  exactKeys(node, ['id', 'kind', 'title', 'detail', 'evidence']);
  if (node.kind !== 'action' && node.kind !== 'condition' && node.kind !== 'result') {
    throw new InvalidVisualization('node.kind가 올바르지 않습니다.');
  }
  return {
    id: textValue(node.id, 'node.id', MAX_ID_LENGTH),
    kind: node.kind,
    title: textValue(node.title, 'node.title', MAX_SHORT_TEXT_LENGTH),
    detail: textValue(node.detail, 'node.detail', MAX_TEXT_LENGTH),
    evidence: evidenceValue(node.evidence, sections),
  };
}

function edgeValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationEdge {
  const edge = record(value, 'edge');
  exactKeys(edge, ['from', 'to', 'label', 'evidence']);
  return {
    from: textValue(edge.from, 'edge.from', MAX_ID_LENGTH),
    to: textValue(edge.to, 'edge.to', MAX_ID_LENGTH),
    label: textValue(edge.label, 'edge.label', MAX_SHORT_TEXT_LENGTH),
    evidence: evidenceValue(edge.evidence, sections),
  };
}

function screenValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationScreen {
  const screen = record(value, 'scenario.screen');
  exactKeys(screen, ['title', 'body', 'evidence'], ['status', 'primaryAction']);
  return {
    title: textValue(screen.title, 'scenario.screen.title', MAX_SHORT_TEXT_LENGTH),
    body: textValue(screen.body, 'scenario.screen.body', MAX_TEXT_LENGTH),
    ...(screen.status === undefined
      ? {}
      : { status: textValue(screen.status, 'scenario.screen.status', MAX_SHORT_TEXT_LENGTH) }),
    ...(screen.primaryAction === undefined
      ? {}
      : { primaryAction: textValue(screen.primaryAction, 'scenario.screen.primaryAction', MAX_SHORT_TEXT_LENGTH) }),
    evidence: evidenceValue(screen.evidence, sections),
  };
}

function scenarioValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationScenario {
  const scenario = record(value, 'scenario');
  exactKeys(
    scenario,
    ['id', 'label', 'description', 'nodeIds', 'outcome', 'evidence'],
    ['screen'],
  );
  const nodeIds = strings(scenario.nodeIds, 'scenario.nodeIds', MAX_NODES).map((nodeId) =>
    textValue(nodeId, 'scenario.nodeIds[]', MAX_ID_LENGTH));
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new InvalidVisualization('scenario.nodeIds가 중복됐습니다.');
  }
  return {
    id: textValue(scenario.id, 'scenario.id', MAX_ID_LENGTH),
    label: textValue(scenario.label, 'scenario.label', MAX_SHORT_TEXT_LENGTH),
    description: textValue(scenario.description, 'scenario.description', MAX_TEXT_LENGTH),
    nodeIds,
    outcome: textValue(scenario.outcome, 'scenario.outcome', MAX_TEXT_LENGTH),
    evidence: evidenceValue(scenario.evidence, sections),
    ...(scenario.screen === undefined ? {} : { screen: screenValue(scenario.screen, sections) }),
  };
}

function ruleValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualizationRule {
  const rule = record(value, 'rule');
  exactKeys(rule, ['id', 'title', 'detail', 'category', 'evidence']);
  if (rule.category !== 'requirement' && rule.category !== 'success' && rule.category !== 'exception') {
    throw new InvalidVisualization('rule.category가 올바르지 않습니다.');
  }
  return {
    id: textValue(rule.id, 'rule.id', MAX_ID_LENGTH),
    title: textValue(rule.title, 'rule.title', MAX_SHORT_TEXT_LENGTH),
    detail: textValue(rule.detail, 'rule.detail', MAX_TEXT_LENGTH),
    category: rule.category,
    evidence: evidenceValue(rule.evidence, sections),
  };
}

function parseValue(
  value: unknown,
  sections: ReadonlyMap<string, readonly string[]>,
): PlanVisualization {
  const root = record(value, '시각화');
  exactKeys(root, ['schemaVersion', 'overview', 'changes', 'nodes', 'edges', 'scenarios', 'rules']);
  if (root.schemaVersion !== 1) throw new InvalidVisualization('지원하지 않는 시각화 schemaVersion입니다.');

  const nodes = arrayValue(root.nodes, 'nodes', MAX_NODES).map((node) => nodeValue(node, sections));
  const nodeIds = new Set(nodes.map(({ id }) => id));
  if (nodeIds.size !== nodes.length) throw new InvalidVisualization('node ID가 중복됐습니다.');

  const edges = arrayValue(root.edges, 'edges', MAX_EDGES).map((edge) => edgeValue(edge, sections));
  if (edges.some(({ from, to }) => !nodeIds.has(from) || !nodeIds.has(to))) {
    throw new InvalidVisualization('edge가 존재하지 않는 node를 가리킵니다.');
  }

  const scenarios = arrayValue(root.scenarios, 'scenarios', MAX_SCENARIOS)
    .map((scenario) => scenarioValue(scenario, sections));
  if (scenarios.some(({ nodeIds: refs }) => refs.some((ref) => !nodeIds.has(ref)))) {
    throw new InvalidVisualization('scenario가 존재하지 않는 node를 가리킵니다.');
  }

  const rules = arrayValue(root.rules, 'rules', MAX_RULES).map((rule) => ruleValue(rule, sections));
  const allIds = [...nodeIds, ...scenarios.map(({ id }) => id), ...rules.map(({ id }) => id)];
  if (new Set(allIds).size !== allIds.length) {
    throw new InvalidVisualization('시각화 ID가 중복됐습니다.');
  }

  return {
    schemaVersion: 1,
    overview: overviewValue(root.overview, sections),
    changes: changesValue(root.changes, sections),
    nodes,
    edges,
    scenarios,
    rules,
  };
}

export function parsePlanVisualization(artifact: ArtifactView): PlanVisualizationParseResult {
  const markerCount = countMarker(artifact.markdown);
  if (markerCount === 0) return { kind: 'absent' };
  const blocks = visualizationBlocks(artifact.markdown);
  if (markerCount !== 1 || blocks.length !== 1) {
    return invalid('시각화 comment는 정확히 하나여야 하며 형식을 지켜야 합니다.');
  }
  const block = blocks[0]!;
  if (new TextEncoder().encode(block.source).byteLength > MAX_COMMENT_BYTES) {
    return invalid('시각화 comment가 64KiB를 넘었습니다.');
  }
  try {
    const parsed = JSON.parse(block.json) as unknown;
    const sections = sectionSegments(artifact, block);
    return { kind: 'ready', value: parseValue(parsed, sections) };
  } catch (error) {
    return invalid(error instanceof InvalidVisualization
      ? error.message
      : '시각화 JSON을 읽을 수 없습니다.');
  }
}

export function stripPlanVisualization(markdown: string): string {
  return markdown.replace(COMMENT_PATTERN, '');
}

/** Returns only the prose that a person owns and edits. */
export function editablePlanMarkdown(markdown: string): string {
  return markdown.replace(HIDDEN_COMMENT_PATTERN, '');
}

/** Keeps system-owned visualization comments while replacing the human-authored prose. */
export function preservePlanVisualization(markdown: string, previousMarkdown: string | undefined): string {
  const prose = editablePlanMarkdown(markdown);
  if (previousMarkdown === undefined) return prose;
  const comments = [...previousMarkdown.matchAll(HIDDEN_COMMENT_PATTERN)].map((match) => match[0]);
  return prose + comments.join('');
}
