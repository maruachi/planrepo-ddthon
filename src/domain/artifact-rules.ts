import type { SrScope } from '@/src/contracts/context';
import type { ArtifactEdit, SectionIndexEntry, WorkflowPlanEdit } from '@/src/contracts/views';

export type ArtifactBasisExpectation =
  | { readonly kind: 'absent' }
  | { readonly kind: 'version'; readonly version: number };

export type ArtifactRuleIssueCode =
  | 'DOCUMENT_KIND_INVALID'
  | 'DESIGN_STAGE_REQUIRED'
  | 'DESIGN_STAGE_FORBIDDEN'
  | 'MARKDOWN_TOO_LARGE'
  | 'SECTION_ID_DUPLICATE'
  | 'SECTION_RANGE_INVALID'
  | 'SECTION_RANGE_OVERLAP'
  | 'SECTION_SOURCE_MISMATCH'
  | 'REQUIREMENT_ID_DUPLICATE'
  | 'REQUIREMENT_SECTION_DUPLICATE'
  | 'REQUIREMENT_SECTION_UNKNOWN'
  | 'REQUIREMENT_SOURCE_MISMATCH'
  | 'REQUIREMENT_CRITERIA_INVALID'
  | 'REFERENCE_SCOPE_MISMATCH'
  | 'REFERENCE_DUPLICATE'
  | 'WORKFLOW_INVALID';

export interface ArtifactRuleIssue {
  readonly code: ArtifactRuleIssueCode;
  readonly path: string;
}

export interface ArtifactBasisRecheck {
  readonly scope: SrScope;
  readonly expected: ArtifactBasisExpectation;
  readonly targetKey: string;
  readonly mustRecheckUnderWriteLock: true;
}

export interface ArtifactRuleAssessment {
  readonly ok: boolean;
  readonly issues: readonly ArtifactRuleIssue[];
  readonly basisRecheck: ArtifactBasisRecheck;
}

export function matchesArtifactBasis(
  current: number | undefined,
  expected: ArtifactBasisExpectation,
): boolean {
  return expected.kind === 'absent'
    ? current === undefined
    : current === expected.version;
}

const ARTIFACT_MARKDOWN_MAX_BYTES = 1_024 * 1_024;
const DOCUMENT_KINDS = new Set([
  'requirements',
  'workflow_plan',
  'design',
  'implementation_plan',
]);
const DESIGN_STAGES = new Set([
  'application',
  'functional',
  'nfr',
  'infrastructure',
]);

interface MarkdownStructure {
  readonly headings: readonly { readonly text: string; readonly offset: number }[];
  readonly searchableRanges: readonly { readonly start: number; readonly end: number }[];
}

function inspectMarkdown(markdown: string): MarkdownStructure {
  const headings: Array<{ readonly text: string; readonly offset: number }> = [];
  const searchableRanges: Array<{ readonly start: number; readonly end: number }> = [];
  let fence: { readonly marker: '`' | '~'; readonly length: number } | undefined;
  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const contentEnd = lineEnd > lineStart && markdown[lineEnd - 1] === '\r'
      ? lineEnd - 1
      : lineEnd;
    const line = markdown.slice(lineStart, contentEnd);
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence !== undefined) {
      if (
        fenceMatch !== null &&
        fenceMatch[2]?.[0] === fence.marker &&
        fenceMatch[2].length >= fence.length &&
        fenceMatch[3]?.trim().length === 0
      ) {
        fence = undefined;
      }
    } else if (fenceMatch !== null) {
      const marker = fenceMatch[2];
      if (marker !== undefined) {
        fence = { marker: marker[0] as '`' | '~', length: marker.length };
      }
    } else if (!/^ {0,3}>/u.test(line)) {
      searchableRanges.push({ start: lineStart, end: contentEnd });
      const heading = /^( {0,3})##[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/u.exec(line);
      const headingText = heading?.[2];
      if (headingText !== undefined) {
        const offset = lineStart + (heading?.[1]?.length ?? 0);
        headings.push({ text: headingText, offset });
      }
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return { headings, searchableRanges };
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /^[\p{L}\p{N}_.-]$/u.test(value);
}

function codePointAt(source: string, index: number): string | undefined {
  const value = source.codePointAt(index);
  return value === undefined ? undefined : String.fromCodePoint(value);
}

function codePointBefore(source: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  let previousIndex = index - 1;
  const trailingUnit = source.charCodeAt(previousIndex);
  if (
    trailingUnit >= 0xDC00 && trailingUnit <= 0xDFFF &&
    previousIndex > 0
  ) {
    const leadingUnit = source.charCodeAt(previousIndex - 1);
    if (leadingUnit >= 0xD800 && leadingUnit <= 0xDBFF) previousIndex -= 1;
  }
  return codePointAt(source, previousIndex);
}

function containsExactIdentifier(source: string, identifier: string): boolean {
  if (identifier.length === 0) return false;
  let fromIndex = 0;
  while (fromIndex <= source.length - identifier.length) {
    const index = source.indexOf(identifier, fromIndex);
    if (index === -1) return false;
    const before = codePointBefore(source, index);
    const after = codePointAt(source, index + identifier.length);
    if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after)) return true;
    fromIndex = index + identifier.length;
  }
  return false;
}

function startsWithExactIdentifier(source: string, identifier: string): boolean {
  return source.startsWith(identifier) &&
    !isIdentifierCharacter(codePointAt(source, identifier.length));
}

export function deriveArtifactSectionIndex(
  markdown: string,
  sectionIds: readonly string[],
): readonly SectionIndexEntry[] {
  if (new Set(sectionIds).size !== sectionIds.length) {
    throw new Error('section ID가 중복됐습니다.');
  }
  const structure = inspectMarkdown(markdown);
  const selected = sectionIds.map((sectionId) => {
    const matches = structure.headings.filter((heading) => startsWithExactIdentifier(heading.text, sectionId));
    if (sectionId.length === 0 || matches.length !== 1) {
      throw new Error(`${sectionId || '빈 section'}의 정확한 Markdown heading을 하나 찾을 수 없습니다.`);
    }
    return { sectionId, heading: matches[0]! };
  }).sort((left, right) => left.heading.offset - right.heading.offset);
  return selected.map(({ sectionId, heading }) => ({
    sectionId,
    title: heading.text.slice(sectionId.length).trim() || sectionId,
    startOffset: heading.offset,
    endOffset: structure.headings.find((candidate) => candidate.offset > heading.offset)?.offset ?? markdown.length,
  }));
}

function rangeContainsIdentifier(
  markdown: string,
  range: { readonly start: number; readonly end: number },
  structure: MarkdownStructure,
  identifier: string,
): boolean {
  return structure.searchableRanges.some((searchable) => {
    const start = Math.max(range.start, searchable.start);
    const end = Math.min(range.end, searchable.end);
    return start < end && containsExactIdentifier(markdown.slice(start, end), identifier);
  });
}

function sameScope(
  scope: SrScope,
  ref: { readonly projectId: string; readonly srId: string },
): boolean {
  return ref.projectId === scope.projectId && ref.srId === scope.srId;
}

function referenceKey(ref: {
  readonly kind: string;
  readonly projectId: string;
  readonly srId: string;
  readonly entityId: string;
  readonly version: number;
}): string {
  return `${ref.kind}:${ref.projectId}:${ref.srId}:${ref.entityId}:${ref.version}`;
}

export function validateArtifactEdit(
  scope: SrScope,
  edit: ArtifactEdit | WorkflowPlanEdit,
): ArtifactRuleAssessment {
  const issues: ArtifactRuleIssue[] = [];
  const add = (code: ArtifactRuleIssueCode, path: string) => {
    issues.push({ code, path });
  };

  if (!DOCUMENT_KINDS.has(edit.kind)) add('DOCUMENT_KIND_INVALID', 'kind');
  const designStage = (edit as { readonly designStage?: unknown }).designStage;
  if (edit.kind === 'design') {
    if (typeof designStage !== 'string' || !DESIGN_STAGES.has(designStage)) {
      add('DESIGN_STAGE_REQUIRED', 'designStage');
    }
  } else if (designStage !== undefined) {
    add('DESIGN_STAGE_FORBIDDEN', 'designStage');
  }

  if (new TextEncoder().encode(edit.markdown).byteLength > ARTIFACT_MARKDOWN_MAX_BYTES) {
    add('MARKDOWN_TOO_LARGE', 'markdown');
  }

  const markdownStructure = inspectMarkdown(edit.markdown);
  const sectionIds = new Set<string>();
  const sectionSources = new Map<string, { readonly start: number; readonly end: number }>();
  let previousEnd = -1;
  for (const [index, section] of edit.sectionIndex.entries()) {
    const path = `sectionIndex[${index}]`;
    if (sectionIds.has(section.sectionId)) add('SECTION_ID_DUPLICATE', `${path}.sectionId`);
    sectionIds.add(section.sectionId);
    const validRange =
      Number.isInteger(section.startOffset) &&
      Number.isInteger(section.endOffset) &&
      section.startOffset >= 0 &&
      section.endOffset > section.startOffset &&
      section.endOffset <= edit.markdown.length;
    if (!validRange) {
      add('SECTION_RANGE_INVALID', path);
      continue;
    }
    if (section.startOffset < previousEnd) add('SECTION_RANGE_OVERLAP', path);
    previousEnd = Math.max(previousEnd, section.endOffset);
    sectionSources.set(section.sectionId, {
      start: section.startOffset,
      end: section.endOffset,
    });
    const headings = markdownStructure.headings.filter((heading) =>
      startsWithExactIdentifier(heading.text, section.sectionId),
    );
    if (
      headings.length !== 1 ||
      headings[0]?.offset !== section.startOffset
    ) {
      add('SECTION_SOURCE_MISMATCH', path);
    }
  }

  const requirementIds = new Set<string>();
  for (const [index, link] of edit.requirementLinks.entries()) {
    const path = `requirementLinks[${index}]`;
    if (requirementIds.has(link.requirementId)) {
      add('REQUIREMENT_ID_DUPLICATE', `${path}.requirementId`);
    }
    requirementIds.add(link.requirementId);
    const linkedIds = new Set<string>();
    let sourceContainsRequirement = false;
    for (const [sectionIndex, sectionId] of link.sectionIds.entries()) {
      if (linkedIds.has(sectionId)) {
        add('REQUIREMENT_SECTION_DUPLICATE', `${path}.sectionIds[${sectionIndex}]`);
      }
      linkedIds.add(sectionId);
      const sourceRange = sectionSources.get(sectionId);
      if (sourceRange === undefined) {
        add('REQUIREMENT_SECTION_UNKNOWN', `${path}.sectionIds[${sectionIndex}]`);
      } else if (rangeContainsIdentifier(
        edit.markdown,
        sourceRange,
        markdownStructure,
        link.requirementId,
      )) {
        sourceContainsRequirement = true;
      }
    }
    if (!sourceContainsRequirement) add('REQUIREMENT_SOURCE_MISMATCH', path);
    if (
      link.acceptanceCriteria.length === 0 ||
      link.acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
    ) {
      add('REQUIREMENT_CRITERIA_INVALID', `${path}.acceptanceCriteria`);
    }
  }

  const validateRefs = (
    refs: readonly {
      readonly kind: string;
      readonly projectId: string;
      readonly srId: string;
      readonly entityId: string;
      readonly version: number;
    }[] | undefined,
    expectedKind: string,
    path: string,
  ) => {
    const seen = new Set<string>();
    for (const [index, ref] of (refs ?? []).entries()) {
      const itemPath = `${path}[${index}]`;
      if (
        ref.kind !== expectedKind ||
        !sameScope(scope, ref) ||
        !Number.isInteger(ref.version) ||
        ref.version < 1
      ) {
        add('REFERENCE_SCOPE_MISMATCH', itemPath);
      }
      const key = referenceKey(ref);
      if (seen.has(key)) add('REFERENCE_DUPLICATE', itemPath);
      seen.add(key);
    }
  };
  validateRefs(edit.decisionRefs, 'decision', 'decisionRefs');
  validateRefs(edit.sourceRefs, 'context_source', 'sourceRefs');
  validateRefs(edit.questionResultRefs, 'question_result', 'questionResultRefs');

  if (edit.targetBasis.kind === 'version') {
    validateRefs([edit.targetBasis.ref], 'artifact', 'targetBasis.ref');
    if (
      edit.artifactId !== undefined &&
      edit.artifactId !== edit.targetBasis.ref.entityId
    ) {
      add('REFERENCE_SCOPE_MISMATCH', 'artifactId');
    }
  }

  const possibleWorkflow = edit as ArtifactEdit & Partial<WorkflowPlanEdit>;
  const hasWorkflowStructure =
    possibleWorkflow.workflowVersion !== undefined ||
    possibleWorkflow.stages !== undefined ||
    possibleWorkflow.implementationUnitCount !== undefined ||
    possibleWorkflow.requirementTaskLinks !== undefined;
  if (edit.kind === 'workflow_plan') {
    if (
      possibleWorkflow.workflowVersion !== 'v1.0.1' ||
      possibleWorkflow.implementationUnitCount !== 1 ||
      !Array.isArray(possibleWorkflow.stages) ||
      possibleWorkflow.stages.length === 0 ||
      !Array.isArray(possibleWorkflow.requirementTaskLinks) ||
      possibleWorkflow.requirementTaskLinks.length === 0
    ) {
      add('WORKFLOW_INVALID', 'workflow');
    } else {
      const stageIds = new Set<string>();
      for (const [index, stage] of possibleWorkflow.stages.entries()) {
        if (stageIds.has(stage.stageId)) add('WORKFLOW_INVALID', `stages[${index}].stageId`);
        stageIds.add(stage.stageId);
        if (stage.choice === 'skipped') {
          if (stage.reason.trim().length === 0) add('WORKFLOW_INVALID', `stages[${index}].reason`);
        } else {
          if (stage.designArtifactRefs.length === 0) {
            add('WORKFLOW_INVALID', `stages[${index}].designArtifactRefs`);
          }
          validateRefs(stage.designArtifactRefs, 'artifact', `stages[${index}].designArtifactRefs`);
        }
      }
      const taskIds = new Set<string>();
      const orders = new Set<number>();
      for (const [index, task] of possibleWorkflow.requirementTaskLinks.entries()) {
        if (taskIds.has(task.taskId)) add('WORKFLOW_INVALID', `requirementTaskLinks[${index}].taskId`);
        taskIds.add(task.taskId);
        if (!Number.isInteger(task.order) || task.order < 1 || orders.has(task.order)) {
          add('WORKFLOW_INVALID', `requirementTaskLinks[${index}].order`);
        }
        orders.add(task.order);
        for (const [requirementIndex, requirementId] of task.requirementIds.entries()) {
          if (!requirementIds.has(requirementId)) {
            add(
              'WORKFLOW_INVALID',
              `requirementTaskLinks[${index}].requirementIds[${requirementIndex}]`,
            );
          }
        }
        if (
          task.verification.length === 0 ||
          task.verification.some((item) => item.trim().length === 0)
        ) {
          add('WORKFLOW_INVALID', `requirementTaskLinks[${index}].verification`);
        }
      }
    }
  } else if (hasWorkflowStructure) {
    add('WORKFLOW_INVALID', 'workflow');
  }

  const basisRecheck: ArtifactBasisRecheck = edit.targetBasis.kind === 'version'
    ? {
        scope,
        expected: { kind: 'version', version: edit.targetBasis.ref.version },
        targetKey: edit.targetBasis.ref.entityId,
        mustRecheckUnderWriteLock: true,
      }
    : {
        scope,
        expected: { kind: 'absent' },
        targetKey: edit.targetBasis.logicalKey,
        mustRecheckUnderWriteLock: true,
      };
  return {
    ok: issues.length === 0,
    issues,
    basisRecheck,
  };
}
