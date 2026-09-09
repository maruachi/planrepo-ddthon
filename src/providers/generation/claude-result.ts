import type { VersionRef } from '../../contracts/context';
import {
  allowedGenerationSourceRefKeys,
  generationSourceRefKey,
} from '../../contracts/generation-source-refs';
import type {
  DecisionAlternative,
  ExecutionReport,
  GenerationResult,
  ProviderFailureCore,
  QuestionProposal,
} from '../../contracts/views';
import type { ProcessResult } from '../../runtime/controlled-process-runner';
import type { ProviderOutcome, ProviderRequest } from './provider-contract';

export const CLAUDE_PROFILE_VERSION = 'claude-cli-2.1.265-planrepo-v2';

export interface DecodeClaudeResultInput {
  readonly stdout: Buffer;
  readonly process: Extract<ProcessResult, { readonly kind: 'Completed' }>;
  readonly request: ProviderRequest;
  readonly providerId?: string;
  readonly profileVersion?: string;
  readonly cliVersion?: string;
  readonly normalizedResultMaxBytes?: number;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function hasOnlyKeys(value: JsonObject, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.includes(key));
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const SR_VERSION_KINDS = new Set([
  'sr_description', 'context_source', 'artifact', 'question_answer', 'question_result',
  'decision', 'scope_classification', 'review_assignment', 'handoff',
]);

function versionRef(value: unknown): VersionRef | undefined {
  const ref = object(value);
  if (ref === undefined || typeof ref.kind !== 'string' || !nonEmptyString(ref.projectId) ||
    !nonEmptyString(ref.entityId) || !Number.isInteger(ref.version) || Number(ref.version) < 1) return undefined;
  if (ref.kind === 'review_policy') {
    if (!hasOnlyKeys(ref, ['kind', 'projectId', 'entityId', 'version'], ['kind', 'projectId', 'entityId', 'version'])) {
      return undefined;
    }
    return ref as unknown as VersionRef;
  }
  if (!SR_VERSION_KINDS.has(ref.kind) || !nonEmptyString(ref.srId) ||
    !hasOnlyKeys(ref, ['kind', 'projectId', 'srId', 'entityId', 'version'], ['kind', 'projectId', 'srId', 'entityId', 'version'])) {
    return undefined;
  }
  return ref as unknown as VersionRef;
}

function allowedAssignees(request: ProviderRequest): Set<string> {
  const ids = new Set<string>();
  for (const item of request.snapshot.contents) {
    if (item.ref.kind !== 'sr') continue;
    try {
      const content = object(JSON.parse(item.content));
      const participants = object(content?.participants);
      if (typeof participants?.ownerId === 'string') ids.add(participants.ownerId);
      if (Array.isArray(participants?.members)) {
        for (const memberValue of participants.members) {
          const member = object(memberValue);
          if (typeof member?.userId === 'string') ids.add(member.userId);
        }
      }
    } catch {
      // Snapshot validation belongs to the repository. An unreadable participant item grants no ID.
    }
  }
  return ids;
}

function sourceRefs(value: unknown, allowed: ReadonlySet<string>): VersionRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs: VersionRef[] = [];
  for (const raw of value) {
    const ref = versionRef(raw);
    if (ref === undefined || !allowed.has(generationSourceRefKey(ref))) return undefined;
    refs.push(ref);
  }
  return refs;
}

function questionProposal(
  value: unknown,
  allowedRefs: ReadonlySet<string>,
  assignees: ReadonlySet<string>,
): QuestionProposal | undefined {
  const item = object(value);
  if (item === undefined || !hasOnlyKeys(
    item,
    ['temporaryId', 'text', 'reason', 'suggestedAssigneeId', 'requiredGate', 'sourceRefs', 'candidateAnswers'],
    ['temporaryId', 'text', 'reason', 'suggestedAssigneeId', 'requiredGate', 'sourceRefs', 'candidateAnswers'],
  )) return undefined;
  const refs = sourceRefs(item.sourceRefs, allowedRefs);
  if (!nonEmptyString(item.temporaryId) || !nonEmptyString(item.text) || !nonEmptyString(item.reason) ||
    !nonEmptyString(item.suggestedAssigneeId) || !assignees.has(item.suggestedAssigneeId) ||
    (item.requiredGate !== 'G1' && item.requiredGate !== 'G2') || refs === undefined ||
    !strings(item.candidateAnswers)) return undefined;
  return {
    temporaryId: item.temporaryId,
    text: item.text,
    reason: item.reason,
    suggestedAssigneeId: item.suggestedAssigneeId,
    requiredGate: item.requiredGate,
    sourceRefs: refs,
    candidateAnswers: item.candidateAnswers,
  };
}

function alternative(value: unknown): DecisionAlternative | undefined {
  const item = object(value);
  if (item === undefined || !hasOnlyKeys(item, ['optionId', 'label', 'description'], ['optionId', 'label', 'description']) ||
    !nonEmptyString(item.optionId) || !nonEmptyString(item.label) || !nonEmptyString(item.description)) return undefined;
  return { optionId: item.optionId, label: item.label, description: item.description };
}

function generationResult(value: unknown, request: ProviderRequest): GenerationResult | undefined {
  const result = object(value);
  if (result === undefined || result.schemaVersion !== 1 || typeof result.kind !== 'string') return undefined;
  const allowedRefs = allowedGenerationSourceRefKeys(request.snapshot.contents);
  if (request.taskKind === 'QUESTION_PROPOSALS') {
    if (result.kind !== 'question_proposals' || !hasOnlyKeys(result, ['schemaVersion', 'kind', 'proposals'], ['schemaVersion', 'kind', 'proposals']) ||
      !Array.isArray(result.proposals) || result.proposals.length === 0) return undefined;
    const proposals = result.proposals.map((item) => questionProposal(item, allowedRefs, allowedAssignees(request)));
    if (proposals.some((item) => item === undefined) ||
      !unique(proposals.map((item) => item?.temporaryId ?? ''))) return undefined;
    return { schemaVersion: 1, kind: 'question_proposals', proposals: proposals as [QuestionProposal, ...QuestionProposal[]] };
  }
  if (request.taskKind === 'DECISION_PROPOSALS') {
    if (result.kind !== 'decision_proposals' || !hasOnlyKeys(result, ['schemaVersion', 'kind', 'proposals'], ['schemaVersion', 'kind', 'proposals']) ||
      !Array.isArray(result.proposals) || result.proposals.length === 0) return undefined;
    const proposals: Array<Extract<GenerationResult, { kind: 'decision_proposals' }>['proposals'][number]> = [];
    for (const raw of result.proposals) {
      const item = object(raw);
      if (item === undefined || !hasOnlyKeys(
        item,
        ['temporaryId', 'prompt', 'alternatives', 'impact', 'recommendation', 'sourceRefs'],
        ['temporaryId', 'prompt', 'alternatives', 'impact', 'recommendation', 'sourceRefs'],
      ) || !nonEmptyString(item.temporaryId) || !nonEmptyString(item.prompt) ||
        !nonEmptyString(item.impact) || !nonEmptyString(item.recommendation) ||
        !Array.isArray(item.alternatives) || item.alternatives.length === 0) return undefined;
      const alternatives = item.alternatives.map(alternative);
      const refs = sourceRefs(item.sourceRefs, allowedRefs);
      if (alternatives.some((entry) => entry === undefined) || refs === undefined ||
        !unique(alternatives.map((entry) => entry?.optionId ?? ''))) return undefined;
      proposals.push({
        temporaryId: item.temporaryId,
        prompt: item.prompt,
        alternatives: alternatives as [DecisionAlternative, ...DecisionAlternative[]],
        impact: item.impact,
        recommendation: item.recommendation,
        sourceRefs: refs,
      });
    }
    if (!unique(proposals.map(({ temporaryId }) => temporaryId))) return undefined;
    return { schemaVersion: 1, kind: 'decision_proposals', proposals: proposals as [typeof proposals[number], ...typeof proposals] };
  }
  if (request.documentKind === undefined || result.kind !== 'artifact' || !hasOnlyKeys(
    result,
    ['schemaVersion', 'kind', 'documentKind', 'markdown', 'requirementRefs', 'changeSummary'],
    ['schemaVersion', 'kind', 'documentKind', 'markdown', 'requirementRefs', 'changeSummary'],
  ) || result.documentKind !== request.documentKind || !nonEmptyString(result.markdown) ||
    !strings(result.requirementRefs) || !unique(result.requirementRefs) || !nonEmptyString(result.changeSummary)) return undefined;
  return {
    schemaVersion: 1,
    kind: 'artifact',
    documentKind: request.documentKind,
    markdown: result.markdown,
    requirementRefs: result.requirementRefs,
    changeSummary: result.changeSummary,
  };
}

function actualModel(envelope: JsonObject): string | undefined {
  const usage = object(envelope.modelUsage);
  if (usage === undefined) return undefined;
  const modelIds = Object.entries(usage)
    .filter(([key, value]) => key.length > 0 && object(value) !== undefined)
    .map(([key]) => key);
  return modelIds.length === 1 ? modelIds[0] : undefined;
}

function verifiedActualModel(envelope: JsonObject, request: ProviderRequest): string | undefined | null {
  const metadataModel = actualModel(envelope);
  if (metadataModel === undefined) return undefined;
  if (request.selection.modelChoice.kind === 'installed_default') return metadataModel;
  if (metadataModel === request.selection.modelChoice.modelId) return metadataModel;
  if (request.selection.modelChoice.modelId === 'global.anthropic.claude-opus-4-8' &&
    metadataModel === 'claude-opus-4-8') return metadataModel;
  return null;
}

function executionReport(input: DecodeClaudeResultInput, modelId?: string): ExecutionReport {
  const metrics = input.process.metrics;
  return {
    providerId: input.providerId ?? input.request.selection.providerId,
    ...(modelId === undefined ? {} : { actualModelId: modelId }),
    ...(input.cliVersion === undefined ? {} : { cliVersion: input.cliVersion }),
    profileVersion: input.profileVersion ?? CLAUDE_PROFILE_VERSION,
    startedAt: metrics.startedAt,
    finishedAt: metrics.finishedAt,
    exitCode: 0,
    stdoutBytes: input.stdout.byteLength,
    stderrBytes: metrics.stderrBytes,
    stdoutClosed: metrics.stdoutClosed,
    stderrClosed: metrics.stderrClosed,
  };
}

function failed(input: DecodeClaudeResultInput, code: ProviderFailureCore['code'], diagnostic: string): ProviderOutcome {
  return { kind: 'failed', failure: { code, diagnostic }, execution: executionReport(input) };
}

export function decodeClaudeResult(input: DecodeClaudeResultInput): ProviderOutcome {
  let envelope: JsonObject;
  try {
    const parsed = object(JSON.parse(input.stdout.toString('utf8')));
    if (parsed === undefined) return failed(input, 'INVALID_OUTPUT', 'Claude 응답 envelope가 올바르지 않습니다.');
    envelope = parsed;
  } catch {
    return failed(input, 'INVALID_OUTPUT', 'Claude 응답 JSON이 완전하지 않습니다.');
  }
  if (envelope.type !== 'result' || typeof envelope.subtype !== 'string' || typeof envelope.is_error !== 'boolean' ||
    typeof envelope.result !== 'string') return failed(input, 'INVALID_OUTPUT', 'Claude 응답 envelope가 올바르지 않습니다.');
  if (envelope.is_error) return failed(input, 'PROVIDER_ERROR', 'Claude provider가 오류를 반환했습니다.');
  if (envelope.subtype !== 'success') return failed(input, 'INVALID_OUTPUT', 'Claude 응답 subtype이 성공이 아닙니다.');
  if (Array.isArray(envelope.permission_denials) && envelope.permission_denials.length > 0) {
    return failed(input, 'UNAVAILABLE', 'Claude가 제한된 명령 또는 도구 사용을 시도했습니다.');
  }
  const modelId = verifiedActualModel(envelope, input.request);
  if (modelId === null) {
    return failed(input, 'INVALID_OUTPUT', 'Claude가 요청과 다른 model을 사용했습니다.');
  }

  let parsedResult: unknown;
  try {
    parsedResult = JSON.parse(envelope.result);
  } catch {
    return failed(input, 'INVALID_OUTPUT', 'Claude 결과 JSON이 완전하지 않습니다.');
  }
  const result = generationResult(parsedResult, input.request);
  if (result === undefined) return failed(input, 'INVALID_OUTPUT', 'Claude 결과가 요청 schema 또는 허용 참조와 맞지 않습니다.');
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > (input.normalizedResultMaxBytes ?? 2_097_152)) {
    return failed(input, 'INVALID_OUTPUT', '정제한 Claude 결과가 허용 크기를 넘었습니다.');
  }
  return { kind: 'completed', result, execution: executionReport(input, modelId) };
}
