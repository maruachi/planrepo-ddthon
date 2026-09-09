import { deriveArtifactSectionIndex } from '@/src/domain/artifact-rules';
import type { RequirementLink, SectionIndexEntry } from '@/src/contracts/views';

export interface DraftDocumentStructure {
  readonly sectionIndex: readonly SectionIndexEntry[];
  readonly requirementLinks: readonly RequirementLink[];
}

export interface PreparedDraftDocument extends DraftDocumentStructure {
  readonly markdown: string;
  readonly structureAdded: boolean;
}

interface HeadingBlock {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly body: string;
}

export function suggestSrKey(title: string): string {
  if (title.trim() === '') return '';
  const ascii = title.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 24);
  if (ascii.length > 0) return `SR-${ascii}`;
  let hash = 2166136261;
  for (const character of title) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `SR-${(hash >>> 0).toString(36).toUpperCase()}`;
}

export function suggestPurpose(title: string): string {
  const normalized = title.trim();
  return normalized === '' ? '' : `${normalized}의 목적과 완료 기준을 구체화합니다.`;
}

export function deriveDraftDocumentStructure(markdown: string): DraftDocumentStructure {
  const headings: Array<{ readonly id: string; readonly offset: number; readonly lineEnd: number }> = [];
  let fenced = false;
  let offset = 0;
  for (const line of markdown.split(/(?<=\n)/u)) {
    const content = line.replace(/\r?\n$/u, '');
    if (/^ {0,3}(`{3,}|~{3,})/u.test(content)) fenced = !fenced;
    if (!fenced && !/^ {0,3}>/u.test(content)) {
      const match = /^ {0,3}##[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/u.exec(content);
      const id = match?.[1]?.trim();
      if (id !== undefined && id.length > 0) headings.push({ id, offset, lineEnd: offset + content.length });
    }
    offset += line.length;
  }
  const unique = headings.filter((heading, index) => headings.findIndex((item) => item.id === heading.id) === index);
  if (unique.length === 0) return { sectionIndex: [], requirementLinks: [] };
  let sectionIndex: readonly SectionIndexEntry[];
  try {
    sectionIndex = deriveArtifactSectionIndex(markdown, unique.map((item) => item.id));
  } catch {
    return { sectionIndex: [], requirementLinks: [] };
  }
  const blocks: readonly HeadingBlock[] = unique.map((heading, index) => ({
    id: heading.id,
    start: heading.offset,
    end: unique[index + 1]?.offset ?? markdown.length,
    body: markdown.slice(heading.lineEnd, unique[index + 1]?.offset ?? markdown.length),
  }));
  return {
    sectionIndex,
    requirementLinks: blocks.map((block) => ({
      requirementId: block.id,
      sectionIds: [block.id],
      acceptanceCriteria: criteriaFrom(block.body, block.id),
    })),
  };
}

export function prepareInitialRequirementsDocument(title: string, markdown: string): PreparedDraftDocument {
  const structure = deriveDraftDocumentStructure(markdown);
  if (structure.sectionIndex.length > 0) return { markdown, ...structure, structureAdded: false };
  const documentTitle = title.trim() || '새 업무';
  const prepared = `# ${documentTitle}\n\n## 요구사항\n\n${markdown}`;
  return { markdown: prepared, ...deriveDraftDocumentStructure(prepared), structureAdded: true };
}

function criteriaFrom(body: string, fallback: string): readonly string[] {
  const lines = body.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const explicit = lines
    .map((line) => /^(?:[-*]\s+(?:\[[ xX]\]\s*)?|(?:완료|수용)\s*기준\s*:\s*)(.+)$/u.exec(line)?.[1]?.trim())
    .filter((line): line is string => line !== undefined && line.length > 0);
  if (explicit.length > 0) return explicit;
  const firstSentence = lines.find((line) => !line.startsWith('#'));
  return [firstSentence ?? `${fallback} 내용을 확인합니다.`];
}
