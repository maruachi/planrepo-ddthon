import type { DatabaseConnection } from './database';
import { allowedGenerationSourceRefKeys, generationSourceRefKey } from '@/src/contracts/generation-source-refs';
import type { ArtifactVersionRef, EntityRef, VersionRef } from '@/src/contracts/context';
import type {
  DecisionAlternative,
  DecisionProposal,
  DraftReviewView,
  DraftApplicationStatus,
  DraftApplicationResult,
  DraftView,
  GenerationResult,
  GenerationDraftIndexView,
  GenerationRunView,
  GenerationTaskKind,
  InputFreshness,
  NonEmpty,
  ProviderSelection,
  QuestionProposal,
} from '@/src/contracts/views';
import {
  decodeSnapshotContents,
  InputSnapshotRepositoryError,
  readInputSnapshot,
} from '@/src/persistence/input-snapshot-repository';

export class GenerationRunReadError extends Error {}

export class GenerationResultInputError extends Error {}

export interface CurrentInputFingerprintRequest {
  readonly projectId: string;
  readonly srId: string;
  readonly taskKind: GenerationTaskKind;
  readonly inputSnapshotId: string;
}

export interface CurrentInputFingerprintPort {
  readCurrentInputFingerprint(
    db: DatabaseConnection,
    request: CurrentInputFingerprintRequest,
  ): string | undefined;
}

interface RunRow {
  readonly run_id: string;
  readonly task_kind: string;
  readonly input_snapshot_id: string;
  readonly snapshot_fingerprint: string;
  readonly snapshot_task_kind: string;
  readonly snapshot_contents_json: string;
  readonly provider_selection_json: string;
  readonly requested_by: string;
  readonly requested_at: string;
  readonly status: string;
  readonly revision: number;
  readonly result_draft_id: string | null;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly error_code: string | null;
  readonly cancelled_by: string | null;
  readonly cancelled_at: string | null;
  readonly payload_json: string;
  readonly termination_confirmed: number;
}

interface DraftRow {
  readonly draft_id: string;
  readonly schema_version: number;
  readonly task_kind: string;
  readonly body_json: string;
  readonly basis_input_snapshot_id: string;
  readonly basis_fingerprint: string;
  readonly provenance_json: string;
  readonly source_run_id: string | null;
  readonly source_draft_id: string | null;
  readonly reviewed_by: string | null;
  readonly reviewed_at: string | null;
}

export interface StoredGenerationDraft {
  readonly view: DraftView;
  readonly inputSnapshotId: string;
  readonly basisFingerprint: string;
}

const UNKNOWN_FRESHNESS_REASON = '현재 생성 입력 기준을 아직 계산할 수 없습니다.';
const TASK_KINDS: readonly GenerationTaskKind[] = [
  'QUESTION_PROPOSALS',
  'DECISION_PROPOSALS',
  'ARTIFACT_DRAFT',
  'ARTIFACT_REVISION',
];
const VERSION_KINDS = [
  'sr_description', 'context_source', 'artifact', 'question_answer', 'question_result',
  'decision', 'scope_classification', 'review_assignment', 'handoff',
] as const;

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new GenerationRunReadError(`${label} JSON이 올바르지 않습니다.`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GenerationRunReadError(`${label}가 객체가 아닙니다.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new GenerationRunReadError(`${label}가 비었습니다.`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new GenerationRunReadError(`${label}가 문자열 배열이 아닙니다.`);
  }
  return value;
}

function nonEmpty<T>(values: readonly T[], label: string): NonEmpty<T> {
  const [first, ...rest] = values;
  if (first === undefined) throw new GenerationRunReadError(`${label}가 비었습니다.`);
  return [first, ...rest];
}

function ensureUniqueIds(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new GenerationRunReadError(`${label} ID가 중복됩니다.`);
  }
}

function taskKind(value: unknown): GenerationTaskKind {
  if (typeof value !== 'string' || !TASK_KINDS.includes(value as GenerationTaskKind)) {
    throw new GenerationRunReadError('generation taskKind가 올바르지 않습니다.');
  }
  return value as GenerationTaskKind;
}

function providerSelection(raw: string): ProviderSelection {
  const value = objectValue(parseJson(raw, 'provider selection'), 'provider selection');
  const providerId = requiredString(value.providerId, 'providerId');
  const choice = objectValue(value.modelChoice, 'modelChoice');
  if (choice.kind === 'installed_default') {
    return { providerId, modelChoice: { kind: 'installed_default' } };
  }
  if (choice.kind === 'explicit') {
    return {
      providerId,
      modelChoice: { kind: 'explicit', modelId: requiredString(choice.modelId, 'modelId') },
    };
  }
  throw new GenerationRunReadError('modelChoice가 올바르지 않습니다.');
}

function executionIdentity(raw: string): {
  readonly actualModelId?: string;
  readonly cliVersion?: string;
} {
  const payload = objectValue(parseJson(raw, 'generation run payload'), 'generation run payload');
  if (payload.execution === undefined) return {};
  const report = objectValue(payload.execution, 'execution report');
  requiredString(report.providerId, 'execution providerId');
  requiredString(report.profileVersion, 'execution profileVersion');
  requiredString(report.startedAt, 'execution startedAt');
  requiredString(report.finishedAt, 'execution finishedAt');
  if (
    (report.actualModelId !== undefined &&
      (typeof report.actualModelId !== 'string' || report.actualModelId.length === 0)) ||
    (report.cliVersion !== undefined &&
      (typeof report.cliVersion !== 'string' || report.cliVersion.length === 0)) ||
    (report.exitCode !== undefined && !Number.isInteger(report.exitCode)) ||
    (report.terminationSignal !== undefined &&
      (typeof report.terminationSignal !== 'string' || report.terminationSignal.length === 0)) ||
    !Number.isInteger(report.stdoutBytes) || Number(report.stdoutBytes) < 0 ||
    !Number.isInteger(report.stderrBytes) || Number(report.stderrBytes) < 0 ||
    typeof report.stdoutClosed !== 'boolean' || typeof report.stderrClosed !== 'boolean'
  ) throw new GenerationRunReadError('execution report가 올바르지 않습니다.');
  return {
    ...(report.actualModelId === undefined ? {} : { actualModelId: report.actualModelId }),
    ...(report.cliVersion === undefined ? {} : { cliVersion: report.cliVersion }),
  };
}

function versionRef(value: unknown, projectId: string, srId: string): VersionRef {
  const ref = objectValue(value, 'source ref');
  const kind = ref.kind;
  if (kind === 'review_policy') {
    if (
      ref.projectId !== projectId || typeof ref.entityId !== 'string' ||
      !Number.isInteger(ref.version)
    ) throw new GenerationRunReadError('project source ref scope가 올바르지 않습니다.');
    return { kind, projectId, entityId: ref.entityId, version: Number(ref.version) };
  }
  if (
    typeof kind !== 'string' || !VERSION_KINDS.includes(kind as typeof VERSION_KINDS[number]) ||
    ref.projectId !== projectId || ref.srId !== srId || typeof ref.entityId !== 'string' ||
    !Number.isInteger(ref.version)
  ) throw new GenerationRunReadError('SR source ref scope가 올바르지 않습니다.');
  return {
    kind: kind as typeof VERSION_KINDS[number],
    projectId,
    srId,
    entityId: ref.entityId,
    version: Number(ref.version),
  };
}

function snapshotSourceRefs(raw: string, projectId: string, srId: string): ReadonlySet<string> {
  try {
    return allowedGenerationSourceRefKeys(decodeSnapshotContents(raw, {
      kind: 'sr', projectId, srId,
    }));
  } catch (error) {
    if (error instanceof InputSnapshotRepositoryError) {
      throw new GenerationRunReadError(error.message);
    }
    throw error;
  }
}

function sourceRefs(
  value: unknown,
  projectId: string,
  srId: string,
  allowedRefs: ReadonlySet<string>,
): readonly VersionRef[] {
  if (!Array.isArray(value)) throw new GenerationRunReadError('sourceRefs가 배열이 아닙니다.');
  return value.map((item) => {
    const ref = versionRef(item, projectId, srId);
    if (!allowedRefs.has(generationSourceRefKey(ref))) {
      throw new GenerationRunReadError('draft source ref가 input snapshot에 없습니다.');
    }
    return ref;
  });
}

function questionProposal(
  value: unknown,
  projectId: string,
  srId: string,
  allowedRefs: ReadonlySet<string>,
): QuestionProposal {
  const proposal = objectValue(value, 'question proposal');
  const requiredGate = proposal.requiredGate;
  if (requiredGate !== 'G1' && requiredGate !== 'G2') {
    throw new GenerationRunReadError('question proposal requiredGate가 올바르지 않습니다.');
  }
  return {
    temporaryId: requiredString(proposal.temporaryId, 'question temporaryId'),
    text: requiredString(proposal.text, 'question text'),
    reason: requiredString(proposal.reason, 'question reason'),
    suggestedAssigneeId: requiredString(proposal.suggestedAssigneeId, 'question assignee'),
    requiredGate,
    sourceRefs: sourceRefs(proposal.sourceRefs, projectId, srId, allowedRefs),
    candidateAnswers: stringArray(proposal.candidateAnswers, 'candidateAnswers'),
  };
}

function decisionAlternative(value: unknown): DecisionAlternative {
  const alternative = objectValue(value, 'decision alternative');
  return {
    optionId: requiredString(alternative.optionId, 'alternative optionId'),
    label: requiredString(alternative.label, 'alternative label'),
    description: requiredString(alternative.description, 'alternative description'),
  };
}

function decisionProposal(
  value: unknown,
  projectId: string,
  srId: string,
  allowedRefs: ReadonlySet<string>,
): DecisionProposal {
  const proposal = objectValue(value, 'decision proposal');
  if (!Array.isArray(proposal.alternatives)) throw new GenerationRunReadError('decision alternatives가 배열이 아닙니다.');
  const alternatives = nonEmpty(proposal.alternatives.map(decisionAlternative), 'decision alternatives');
  ensureUniqueIds(alternatives.map(({ optionId }) => optionId), 'decision alternative');
  return {
    temporaryId: requiredString(proposal.temporaryId, 'decision temporaryId'),
    prompt: requiredString(proposal.prompt, 'decision prompt'),
    alternatives,
    impact: requiredString(proposal.impact, 'decision impact'),
    recommendation: requiredString(proposal.recommendation, 'decision recommendation'),
    sourceRefs: sourceRefs(proposal.sourceRefs, projectId, srId, allowedRefs),
  };
}

function generationResult(
  raw: string,
  projectId: string,
  srId: string,
  allowedRefs: ReadonlySet<string>,
): GenerationResult {
  const body = objectValue(parseJson(raw, 'generation result'), 'generation result');
  if (body.schemaVersion !== 1) throw new GenerationRunReadError('generation result schemaVersion이 올바르지 않습니다.');
  if (body.kind === 'question_proposals') {
    if (!Array.isArray(body.proposals)) throw new GenerationRunReadError('question proposals가 배열이 아닙니다.');
    const proposals = nonEmpty(
      body.proposals.map((item) => questionProposal(item, projectId, srId, allowedRefs)),
      'question proposals',
    );
    ensureUniqueIds(proposals.map(({ temporaryId }) => temporaryId), 'question proposal temporary');
    return {
      schemaVersion: 1,
      kind: 'question_proposals',
      proposals,
    };
  }
  if (body.kind === 'decision_proposals') {
    if (!Array.isArray(body.proposals)) throw new GenerationRunReadError('decision proposals가 배열이 아닙니다.');
    const proposals = nonEmpty(
      body.proposals.map((item) => decisionProposal(item, projectId, srId, allowedRefs)),
      'decision proposals',
    );
    ensureUniqueIds(proposals.map(({ temporaryId }) => temporaryId), 'decision proposal temporary');
    return {
      schemaVersion: 1,
      kind: 'decision_proposals',
      proposals,
    };
  }
  if (body.kind === 'artifact') {
    const documentKind = body.documentKind;
    if (
      documentKind !== 'requirements' && documentKind !== 'workflow_plan' &&
      documentKind !== 'design' && documentKind !== 'implementation_plan'
    ) throw new GenerationRunReadError('artifact documentKind가 올바르지 않습니다.');
    const requirementRefs = stringArray(body.requirementRefs, 'artifact requirementRefs');
    ensureUniqueIds(requirementRefs, 'artifact requirement');
    return {
      schemaVersion: 1,
      kind: 'artifact',
      documentKind,
      markdown: requiredString(body.markdown, 'artifact markdown'),
      requirementRefs,
      changeSummary: requiredString(body.changeSummary, 'artifact changeSummary'),
    };
  }
  throw new GenerationRunReadError('generation result kind가 올바르지 않습니다.');
}

export function validateGenerationResultInput(
  value: GenerationResult,
  projectId: string,
  srId: string,
  allowedRefs: readonly VersionRef[],
): GenerationResult {
  try {
    return generationResult(
      JSON.stringify(value),
      projectId,
      srId,
      new Set(allowedRefs.map(generationSourceRefKey)),
    );
  } catch (error) {
    if (error instanceof GenerationRunReadError) {
      throw new GenerationResultInputError(error.message);
    }
    throw error;
  }
}

export function readStoredGenerationDraft(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  draftId: string,
  currentFingerprint?: string,
): StoredGenerationDraft | undefined {
  const row = db.prepare(
    `SELECT draft_id,schema_version,task_kind,body_json,basis_input_snapshot_id,
            basis_fingerprint,provenance_json,source_run_id,source_draft_id,reviewed_by,reviewed_at
       FROM generation_drafts WHERE project_id=? AND sr_id=? AND draft_id=?`,
  ).get(projectId, srId, draftId) as DraftRow | undefined;
  if (row === undefined) return undefined;
  const snapshot = db.prepare(
    `SELECT task_kind,content_fingerprint,contents_json FROM input_snapshots
      WHERE project_id=? AND sr_id=? AND snapshot_id=?`,
  ).get(projectId, srId, row.basis_input_snapshot_id) as {
    readonly task_kind: string;
    readonly content_fingerprint: string;
    readonly contents_json: string;
  } | undefined;
  if (snapshot === undefined) throw new GenerationRunReadError('draft input snapshot을 찾을 수 없습니다.');
  const currentTaskKind = taskKind(row.task_kind);
  if (
    row.schema_version !== 1 || taskKind(snapshot.task_kind) !== currentTaskKind ||
    row.basis_fingerprint !== snapshot.content_fingerprint
  ) throw new GenerationRunReadError('draft와 input snapshot 기준이 일치하지 않습니다.');
  const body = generationResult(
    row.body_json,
    projectId,
    srId,
    snapshotSourceRefs(snapshot.contents_json, projectId, srId),
  );
  if (
    (currentTaskKind === 'QUESTION_PROPOSALS' && body.kind !== 'question_proposals') ||
    (currentTaskKind === 'DECISION_PROPOSALS' && body.kind !== 'decision_proposals') ||
    ((currentTaskKind === 'ARTIFACT_DRAFT' || currentTaskKind === 'ARTIFACT_REVISION') && body.kind !== 'artifact')
  ) throw new GenerationRunReadError('draft task와 body 종류가 일치하지 않습니다.');
  const rawProvenance = objectValue(parseJson(row.provenance_json, 'draft provenance'), 'draft provenance');
  let provenance: DraftView['provenance'];
  if (rawProvenance.kind === 'provider') {
    const sourceRunId = requiredString(rawProvenance.sourceRunId, 'draft sourceRunId');
    if (
      row.source_run_id !== sourceRunId || row.source_draft_id !== null ||
      row.reviewed_by !== null || row.reviewed_at !== null
    ) throw new GenerationRunReadError('provider draft provenance가 저장 열과 다릅니다.');
    provenance = { kind: 'provider', sourceRunId };
  } else if (rawProvenance.kind === 'human_review') {
    const sourceDraftId = requiredString(rawProvenance.sourceDraftId, 'review sourceDraftId');
    const reviewedBy = requiredString(rawProvenance.reviewedBy, 'reviewedBy');
    const reviewedAt = requiredString(rawProvenance.reviewedAt, 'reviewedAt');
    const comparisonSummary = requiredString(rawProvenance.comparisonSummary, 'comparisonSummary');
    if (
      row.source_run_id !== null || row.source_draft_id !== sourceDraftId ||
      row.reviewed_by !== reviewedBy || row.reviewed_at !== reviewedAt
    ) throw new GenerationRunReadError('human review draft provenance가 저장 열과 다릅니다.');
    provenance = { kind: 'human_review', sourceDraftId, reviewedBy, reviewedAt, comparisonSummary };
  } else {
    throw new GenerationRunReadError('draft provenance kind가 올바르지 않습니다.');
  }
  const resolvedFreshness = freshness(row.basis_fingerprint, currentFingerprint);
  return {
    inputSnapshotId: row.basis_input_snapshot_id,
    basisFingerprint: row.basis_fingerprint,
    view: {
      draftId: row.draft_id,
      schemaVersion: 1,
      taskKind: currentTaskKind,
      body,
      basisInputSnapshotRef: row.basis_input_snapshot_id,
      basisFingerprint: row.basis_fingerprint,
      provenance,
      freshness: resolvedFreshness,
      ...(resolvedFreshness === 'stale' ? { staleReason: '현재 생성 입력 지문과 다릅니다.' } : {}),
      application: applicationStatus(db, projectId, srId, row.draft_id),
    },
  };
}

function readDraftCurrentFingerprint(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  inputSnapshotId: string,
  draftTaskKind: GenerationTaskKind,
  currentInputFingerprints?: CurrentInputFingerprintPort,
): string | undefined {
  const current = currentInputFingerprints?.readCurrentInputFingerprint(db, {
    projectId,
    srId,
    taskKind: draftTaskKind,
    inputSnapshotId,
  });
  return current === undefined ? undefined : requiredString(current, 'current input fingerprint');
}

export function readGenerationDrafts(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  currentInputFingerprints?: CurrentInputFingerprintPort,
): readonly GenerationDraftIndexView[] {
  const rows = db.prepare(
    `SELECT draft_id,task_kind,basis_input_snapshot_id
       FROM generation_drafts
      WHERE project_id=? AND sr_id=? ORDER BY created_at,draft_id`,
  ).all(projectId, srId) as Array<{
    readonly draft_id: string;
    readonly task_kind: string;
    readonly basis_input_snapshot_id: string;
  }>;
  return rows.map((row) => {
    const currentTaskKind = taskKind(row.task_kind);
    const currentFingerprint = readDraftCurrentFingerprint(
      db,
      projectId,
      srId,
      row.basis_input_snapshot_id,
      currentTaskKind,
      currentInputFingerprints,
    );
    const stored = readStoredGenerationDraft(
      db, projectId, srId, row.draft_id, currentFingerprint,
    );
    if (stored === undefined) throw new GenerationRunReadError('generation draft 목록 행을 찾을 수 없습니다.');
    const draft = stored.view;
    return {
      draftId: draft.draftId,
      taskKind: draft.taskKind,
      basisInputSnapshotRef: draft.basisInputSnapshotRef,
      basisFingerprint: draft.basisFingerprint,
      provenance: draft.provenance,
      freshness: draft.freshness,
      application: draft.application,
    };
  });
}

export function readGenerationDraftReview(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  draftId: string,
  currentInputFingerprints?: CurrentInputFingerprintPort,
): DraftReviewView | undefined {
  const row = db.prepare(
    `SELECT task_kind,basis_input_snapshot_id FROM generation_drafts
      WHERE project_id=? AND sr_id=? AND draft_id=?`,
  ).get(projectId, srId, draftId) as {
    readonly task_kind: string;
    readonly basis_input_snapshot_id: string;
  } | undefined;
  if (row === undefined) return undefined;
  const currentTaskKind = taskKind(row.task_kind);
  const currentFingerprint = readDraftCurrentFingerprint(
    db,
    projectId,
    srId,
    row.basis_input_snapshot_id,
    currentTaskKind,
    currentInputFingerprints,
  );
  const stored = readStoredGenerationDraft(db, projectId, srId, draftId, currentFingerprint);
  if (stored === undefined) throw new GenerationRunReadError('generation draft를 찾을 수 없습니다.');
  const inputSnapshot = readInputSnapshot(
    db, { kind: 'sr', projectId, srId }, stored.inputSnapshotId,
  );
  if (inputSnapshot === undefined) throw new GenerationRunReadError('draft input snapshot을 찾을 수 없습니다.');
  return { draft: stored.view, inputSnapshot };
}

function entityRef(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
  expectedKind: 'question',
): EntityRef<'question'>;
function entityRef(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
  expectedKind: 'decision',
): EntityRef<'decision'>;
function entityRef(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
  expectedKind: 'question' | 'decision',
): EntityRef<'question'> | EntityRef<'decision'> {
  const ref = objectValue(value, 'application output ref');
  if (
    ref.projectId !== projectId || ref.srId !== srId ||
    typeof ref.entityId !== 'string' ||
    ref.kind !== expectedKind
  ) {
    throw new GenerationRunReadError('application output ref project가 올바르지 않습니다.');
  }
  const table = expectedKind === 'question' ? 'questions' : 'decisions';
  const idColumn = expectedKind === 'question' ? 'question_id' : 'decision_id';
  const exists = db.prepare(
    `SELECT 1 FROM ${table} WHERE project_id=? AND sr_id=? AND ${idColumn}=?`,
  ).get(projectId, srId, ref.entityId);
  if (exists === undefined) throw new GenerationRunReadError('application output ref 대상이 없습니다.');
  return expectedKind === 'question'
    ? { kind: 'question', projectId, srId, entityId: ref.entityId }
    : { kind: 'decision', projectId, srId, entityId: ref.entityId };
}

function artifactVersionRef(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
): ArtifactVersionRef {
  const parsed = versionRef(value, projectId, srId);
  if (parsed.kind !== 'artifact') {
    throw new GenerationRunReadError('문서 적용 결과가 artifact version ref가 아닙니다.');
  }
  const exists = db.prepare(
    `SELECT 1 FROM artifact_versions
      WHERE project_id=? AND sr_id=? AND artifact_id=? AND version=?`,
  ).get(projectId, srId, parsed.entityId, parsed.version);
  if (exists === undefined) {
    throw new GenerationRunReadError('문서 적용 결과 version을 찾을 수 없습니다.');
  }
  return {
    kind: 'artifact', projectId, srId,
    entityId: parsed.entityId, version: parsed.version,
  };
}

function applicationMappingValues(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
  expectedKind: 'question',
): NonEmpty<{ readonly temporaryId: string; readonly ref: EntityRef<'question'> }>;
function applicationMappingValues(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
  expectedKind: 'decision',
): NonEmpty<{ readonly temporaryId: string; readonly ref: EntityRef<'decision'> }>;
function applicationMappingValues(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
  expectedKind: 'question' | 'decision',
): NonEmpty<{
  readonly temporaryId: string;
  readonly ref: EntityRef<'question'> | EntityRef<'decision'>;
}> {
  if (!Array.isArray(value)) {
    throw new GenerationRunReadError('draft application mappings가 배열이 아닙니다.');
  }
  const temporaryIds = new Set<string>();
  const entityIds = new Set<string>();
  return nonEmpty(value.map((entry) => {
    const mapping = objectValue(entry, 'draft application mapping');
    const temporaryId = requiredString(mapping.temporaryId, 'draft temporaryId');
    const ref = expectedKind === 'question'
      ? entityRef(db, mapping.ref, projectId, srId, 'question')
      : entityRef(db, mapping.ref, projectId, srId, 'decision');
    if (temporaryIds.has(temporaryId) || entityIds.has(ref.entityId)) {
      throw new GenerationRunReadError('draft application mapping이 중복됐습니다.');
    }
    temporaryIds.add(temporaryId);
    entityIds.add(ref.entityId);
    return { temporaryId, ref };
  }), 'draft application mappings');
}

function applicationResult(
  db: DatabaseConnection,
  value: unknown,
  projectId: string,
  srId: string,
): DraftApplicationResult {
  const result = objectValue(value, 'draft application result');
  if (result.kind === 'artifact') {
    return {
      kind: 'artifact',
      artifactVersionRef: artifactVersionRef(
        db, result.artifactVersionRef, projectId, srId,
      ),
    };
  }
  if (result.kind === 'questions') {
    return {
      kind: 'questions',
      mappings: applicationMappingValues(db, result.mappings, projectId, srId, 'question'),
    };
  }
  if (result.kind === 'decisions') {
    return {
      kind: 'decisions',
      mappings: applicationMappingValues(db, result.mappings, projectId, srId, 'decision'),
    };
  }
  throw new GenerationRunReadError('draft application result kind가 올바르지 않습니다.');
}

function applicationStatus(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  draftId: string | null,
): DraftApplicationStatus {
  if (draftId === null) return { kind: 'not_applied' };
  const row = db.prepare(
    `SELECT application_id,output_refs_json FROM draft_applications
      WHERE project_id=? AND sr_id=? AND draft_id=?`,
  ).get(projectId, srId, draftId) as {
    application_id: string;
    output_refs_json: string;
  } | undefined;
  if (row === undefined) return { kind: 'not_applied' };
  requiredString(row.application_id, 'draft application id');
  return {
    kind: 'applied',
    applicationId: row.application_id,
    result: applicationResult(
      db,
      parseJson(row.output_refs_json, 'draft application result'),
      projectId,
      srId,
    ),
  };
}

function freshness(
  storedFingerprint: string,
  currentFingerprint: string | undefined,
): InputFreshness {
  if (currentFingerprint === undefined) {
    return { kind: 'unknown', reason: UNKNOWN_FRESHNESS_REASON };
  }
  return currentFingerprint === storedFingerprint ? 'current' : 'stale';
}

function draftView(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  run: RunRow,
  runTaskKind: GenerationTaskKind,
  currentFingerprint: string | undefined,
): DraftView {
  if (run.result_draft_id === null) throw new GenerationRunReadError('succeeded run의 draft ref가 없습니다.');
  const row = db.prepare(
    `SELECT draft_id,schema_version,task_kind,body_json,basis_input_snapshot_id,
            basis_fingerprint,provenance_json,source_run_id,source_draft_id,reviewed_by,reviewed_at
       FROM generation_drafts WHERE project_id=? AND sr_id=? AND draft_id=?`,
  ).get(projectId, srId, run.result_draft_id) as DraftRow | undefined;
  if (row === undefined) throw new GenerationRunReadError('succeeded run의 draft를 찾을 수 없습니다.');
  const draftTaskKind = taskKind(row.task_kind);
  if (
    row.schema_version !== 1 || draftTaskKind !== runTaskKind ||
    row.basis_input_snapshot_id !== run.input_snapshot_id
  ) throw new GenerationRunReadError('succeeded run과 draft 기준이 일치하지 않습니다.');
  requiredString(row.draft_id, 'generation draft id');
  requiredString(row.basis_fingerprint, 'generation draft basis fingerprint');
  if (row.basis_fingerprint !== run.snapshot_fingerprint) {
    throw new GenerationRunReadError('provider draft의 basis fingerprint가 snapshot과 일치하지 않습니다.');
  }
  const body = generationResult(
    row.body_json,
    projectId,
    srId,
    snapshotSourceRefs(run.snapshot_contents_json, projectId, srId),
  );
  if (
    (draftTaskKind === 'QUESTION_PROPOSALS' && body.kind !== 'question_proposals') ||
    (draftTaskKind === 'DECISION_PROPOSALS' && body.kind !== 'decision_proposals') ||
    ((draftTaskKind === 'ARTIFACT_DRAFT' || draftTaskKind === 'ARTIFACT_REVISION') && body.kind !== 'artifact')
  ) throw new GenerationRunReadError('generation task와 draft body 종류가 일치하지 않습니다.');
  const rawProvenance = objectValue(parseJson(row.provenance_json, 'draft provenance'), 'draft provenance');
  let provenance: DraftView['provenance'];
  if (rawProvenance.kind === 'provider') {
    const sourceRunId = requiredString(rawProvenance.sourceRunId, 'draft sourceRunId');
    if (row.source_run_id !== run.run_id || sourceRunId !== run.run_id) {
      throw new GenerationRunReadError('provider draft의 source run이 일치하지 않습니다.');
    }
    if (
      row.source_draft_id !== null || row.reviewed_by !== null || row.reviewed_at !== null
    ) throw new GenerationRunReadError('provider draft에 human review 근거가 섞였습니다.');
    provenance = { kind: 'provider', sourceRunId };
  } else {
    throw new GenerationRunReadError('succeeded run의 draft provenance가 provider가 아닙니다.');
  }
  const draftFreshness = freshness(row.basis_fingerprint, currentFingerprint);
  return {
    draftId: row.draft_id,
    schemaVersion: 1,
    taskKind: draftTaskKind,
    body,
    basisInputSnapshotRef: row.basis_input_snapshot_id,
    basisFingerprint: row.basis_fingerprint,
    provenance,
    freshness: draftFreshness,
    ...(draftFreshness === 'stale' ? { staleReason: '현재 생성 입력 지문과 다릅니다.' } : {}),
    application: applicationStatus(db, projectId, srId, row.draft_id),
  };
}

export function readGenerationRuns(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  currentInputFingerprints?: CurrentInputFingerprintPort,
): readonly GenerationRunView[] {
  const rows = db.prepare(
    `SELECT r.run_id,r.task_kind,r.input_snapshot_id,s.content_fingerprint AS snapshot_fingerprint,
            s.task_kind AS snapshot_task_kind,s.contents_json AS snapshot_contents_json,
            r.provider_selection_json,r.requested_by,r.requested_at,r.status,r.revision,
            r.result_draft_id,r.started_at,r.finished_at,r.error_code,r.cancelled_by,r.cancelled_at,
            r.payload_json,
            EXISTS(SELECT 1 FROM execution_observations o
                    WHERE o.project_id=r.project_id AND o.sr_id=r.sr_id AND o.run_id=r.run_id)
              AS termination_confirmed
       FROM generation_runs r JOIN input_snapshots s
         ON s.project_id=r.project_id AND s.sr_id=r.sr_id AND s.snapshot_id=r.input_snapshot_id
      WHERE r.project_id=? AND r.sr_id=? ORDER BY r.requested_at,r.run_id`,
  ).all(projectId, srId) as RunRow[];

  return rows.map((row): GenerationRunView => {
    const currentTaskKind = taskKind(row.task_kind);
    if (taskKind(row.snapshot_task_kind) !== currentTaskKind) {
      throw new GenerationRunReadError('generation run과 input snapshot 작업 종류가 일치하지 않습니다.');
    }
    requiredString(row.run_id, 'generation run id');
    requiredString(row.input_snapshot_id, 'generation input snapshot id');
    requiredString(row.snapshot_fingerprint, 'generation snapshot fingerprint');
    requiredString(row.requested_by, 'generation requestedBy');
    requiredString(row.requested_at, 'generation requestedAt');
    if (!Number.isInteger(row.revision) || row.revision < 0) {
      throw new GenerationRunReadError('generation run revision이 올바르지 않습니다.');
    }
    if (row.termination_confirmed !== 0 && row.termination_confirmed !== 1) {
      throw new GenerationRunReadError('generation run 종료 관찰 값이 올바르지 않습니다.');
    }
    const resolvedCurrentFingerprint = currentInputFingerprints?.readCurrentInputFingerprint(db, {
      projectId,
      srId,
      taskKind: currentTaskKind,
      inputSnapshotId: row.input_snapshot_id,
    });
    const currentFingerprint = resolvedCurrentFingerprint === undefined
      ? undefined
      : requiredString(resolvedCurrentFingerprint, 'current input fingerprint');
    const application = applicationStatus(db, projectId, srId, row.result_draft_id);
    const observedExecution = executionIdentity(row.payload_json);
    const base = {
      scope: { kind: 'sr' as const, projectId, srId },
      runId: row.run_id,
      taskKind: currentTaskKind,
      inputSnapshotId: row.input_snapshot_id,
      revision: row.revision,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      requestedSelection: providerSelection(row.provider_selection_json),
      ...observedExecution,
      freshness: freshness(row.snapshot_fingerprint, currentFingerprint),
      termination: row.termination_confirmed === 1 ? 'confirmed' as const : 'unobserved' as const,
      application,
    };
    if (row.status === 'pending') return { ...base, status: 'pending' };
    if (row.status === 'running') {
      if (row.started_at === null) throw new GenerationRunReadError('running generation run의 시작 시각이 없습니다.');
      return { ...base, status: 'running', startedAt: row.started_at };
    }
    if (row.status === 'succeeded') {
      if (row.finished_at === null) throw new GenerationRunReadError('succeeded generation run의 완료 시각이 없습니다.');
      return {
        ...base,
        status: 'succeeded',
        draft: draftView(db, projectId, srId, row, currentTaskKind, currentFingerprint),
        finishedAt: row.finished_at,
      };
    }
    if (row.status === 'failed') {
      if (row.error_code === null || row.finished_at === null) {
        throw new GenerationRunReadError('failed generation run의 오류 근거가 없습니다.');
      }
      return {
        ...base,
        status: 'failed',
        error: { code: row.error_code, diagnostic: '세부 진단은 제거되었습니다.' },
        finishedAt: row.finished_at,
      };
    }
    if (row.status === 'cancelled') {
      if (row.cancelled_by === null || row.cancelled_at === null) {
        throw new GenerationRunReadError('cancelled generation run의 취소 근거가 없습니다.');
      }
      return {
        ...base,
        status: 'cancelled',
        cancelledBy: row.cancelled_by,
        cancelledAt: row.cancelled_at,
      };
    }
    throw new GenerationRunReadError('generation run status가 올바르지 않습니다.');
  });
}
