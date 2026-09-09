import type {
  ArtifactVersionRef,
  ContextSourceVersionRef,
  DecisionVersionRef,
  EntityRef,
  EvidenceRef,
  QuestionAnswerVersionRef,
  QuestionResultSnapshotRef,
  ScopeClassificationRef,
  SrDescriptionVersionRef,
  SrScope,
  SrVersionKind,
  SrVersionRef,
  VersionRef,
} from '@/src/contracts/context';
import type {
  DecisionAlternative,
  DocumentKind,
  RequirementLink,
  RequirementTaskLink,
  SectionIndexEntry,
  WorkflowStageInput,
} from '@/src/contracts/views';
import {
  artifactLogicalTarget,
  type ArtifactLogicalKey,
  type DesignStage,
} from '@/src/domain/artifact-target';
import {
  readContextSources,
  type StoredContextSource,
} from '@/src/persistence/context-source-repository';
import type { DatabaseConnection } from '@/src/persistence/database';

type JsonObject = Readonly<Record<string, unknown>>;

export class GenerationBasisReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationBasisReadError';
  }
}

export interface GenerationParticipants {
  readonly ownerId: string;
  readonly members: readonly {
    readonly userId: string;
    readonly displayName: string;
  }[];
}

export type GenerationEvidence =
  | { readonly text: string }
  | { readonly refs: readonly EvidenceRef[] };

export interface GenerationDescriptionBasis {
  readonly ref: SrDescriptionVersionRef;
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
}

interface GenerationSourceBasisBase {
  readonly ref: ContextSourceVersionRef;
  readonly displayName: string | null;
  readonly provenance: string;
}

type GenerationSourceContentBasis =
  | { readonly kind: 'text' | 'markdown'; readonly content: string }
  | {
      readonly kind: 'link';
      readonly targetUrl: string;
      readonly verifiable: boolean;
      readonly observedExternalVersion?: string;
      readonly unavailableReason?: string;
    };

type GenerationSourceConfirmationBasis =
  | { readonly confirmation: 'unconfirmed' }
  | {
      readonly confirmation: 'confirmed';
      readonly confirmedBy: string;
      readonly confirmedAt: string;
      readonly confirmationEvidence: string;
    };

export type GenerationSourceBasis = GenerationSourceBasisBase &
  GenerationSourceContentBasis & GenerationSourceConfirmationBasis;

export interface GenerationAnswerBasis {
  readonly ref: QuestionAnswerVersionRef;
  readonly answerText: string;
  readonly selectedOptionId: string | null;
  readonly evidence: GenerationEvidence;
  readonly answeredBy: string;
}

export interface GenerationQuestionResolutionBasis {
  readonly selectedAnswerRef: QuestionAnswerVersionRef;
  readonly evidence: GenerationEvidence;
  readonly documentDisposition:
    | { readonly kind: 'reflected'; readonly artifactVersionRefs: readonly ArtifactVersionRef[] }
    | { readonly kind: 'not_required'; readonly reason: string };
  readonly resolvedBy: string;
  readonly resolvedAt: string;
}

export interface GenerationQuestionBasis {
  readonly resultRef: QuestionResultSnapshotRef;
  readonly questionId: string;
  readonly text: string;
  readonly reason: string;
  readonly assigneeId: string;
  readonly answerMode: 'choice' | 'free_text';
  readonly options: readonly { readonly optionId: string; readonly text: string }[];
  readonly status: 'open' | 'answered' | 'resolved' | 'converted_to_decision';
  readonly classificationRef: ScopeClassificationRef;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly candidateAnswers: readonly string[];
  readonly selectedAnswer: GenerationAnswerBasis | null;
  readonly resolution: GenerationQuestionResolutionBasis | null;
  readonly convertedDecisionId: string | null;
}

export interface GenerationDecisionVersionBasis {
  readonly ref: DecisionVersionRef;
  readonly prompt: string;
  readonly alternatives: readonly DecisionAlternative[];
  readonly impact: string;
  readonly selectedOption: string;
  readonly rationale: string;
  readonly evidence: GenerationEvidence;
  readonly decisionMakerId: string;
  readonly classificationRef: ScopeClassificationRef;
  readonly originQuestionId: string | null;
  readonly originQuestionResultSnapshotRef: QuestionResultSnapshotRef | null;
  readonly affectedRequirementIds: readonly string[];
  readonly artifactVersionRefs: readonly ArtifactVersionRef[];
  readonly previousVersionRef: DecisionVersionRef | null;
  readonly changeReason: string | null;
}

export interface GenerationDecisionBasis {
  readonly definition: {
    readonly decisionId: string;
    readonly prompt: string;
    readonly alternatives: readonly DecisionAlternative[];
    readonly impact: string;
    readonly decisionMakerId: string;
    readonly classificationRef: ScopeClassificationRef;
    readonly originQuestionId: string | null;
    readonly originQuestionResultSnapshotRef: QuestionResultSnapshotRef | null;
  };
  readonly currentVersion: GenerationDecisionVersionBasis | null;
}

export interface GenerationClassificationBasis {
  readonly ref: ScopeClassificationRef;
  readonly target: EntityRef<'question' | 'decision'>;
  readonly scope: 'current' | 'followup';
  readonly requiredGate: 'G1' | 'G2' | 'None';
  readonly reason: string;
  readonly ownerId: string | null;
  readonly revisitAt: string | null;
  readonly revisitEvent: string | null;
  readonly basisRefs: readonly VersionRef[];
}

export interface GenerationArtifactBasis {
  readonly ref: ArtifactVersionRef;
  readonly kind: DocumentKind;
  readonly designStage?: DesignStage;
  readonly logicalKey: ArtifactLogicalKey;
  readonly markdown: string;
  readonly sectionIndex: readonly SectionIndexEntry[];
  readonly requirementLinks: readonly RequirementLink[];
  readonly decisionRefs: readonly DecisionVersionRef[];
  readonly sourceRefs: readonly ContextSourceVersionRef[];
  readonly questionResultRefs: readonly QuestionResultSnapshotRef[];
  readonly workflowPlan?: {
    readonly workflowVersion: 'v1.0.1';
    readonly stages: readonly WorkflowStageInput[];
    readonly implementationUnitCount: 1;
    readonly requirementTaskLinks: readonly RequirementTaskLink[];
  };
}

export interface GenerationBasis {
  readonly scope: SrScope;
  readonly workflowVersion: 'v1.0.1';
  readonly participants: GenerationParticipants;
  readonly currentDescription: GenerationDescriptionBasis;
  readonly sources: readonly GenerationSourceBasis[];
  readonly questions: readonly GenerationQuestionBasis[];
  readonly decisions: readonly GenerationDecisionBasis[];
  readonly classifications: readonly GenerationClassificationBasis[];
  readonly artifacts: readonly GenerationArtifactBasis[];
}

function generationSourceBasis(source: StoredContextSource): GenerationSourceBasis {
  const base: GenerationSourceBasisBase = {
    ref: source.currentVersionRef,
    displayName: source.displayName ?? null,
    provenance: source.provenance,
  };
  const content: GenerationSourceContentBasis = source.kind === 'link'
    ? {
        kind: 'link',
        targetUrl: source.targetUrl,
        verifiable: source.verifiable,
        ...(source.observedExternalVersion === undefined
          ? {}
          : { observedExternalVersion: source.observedExternalVersion }),
        ...(source.unavailableReason === undefined
          ? {}
          : { unavailableReason: source.unavailableReason }),
      }
    : { kind: source.kind, content: source.content };
  const confirmation: GenerationSourceConfirmationBasis = source.confirmation === 'confirmed'
    ? {
        confirmation: 'confirmed',
        confirmedBy: source.confirmedBy,
        confirmedAt: source.confirmedAt,
        confirmationEvidence: source.confirmationEvidence,
      }
    : { confirmation: 'unconfirmed' };
  return { ...base, ...content, ...confirmation };
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new GenerationBasisReadError(`${label} JSON이 올바르지 않습니다.`);
  }
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GenerationBasisReadError(`${label}이 객체가 아닙니다.`);
  }
  return value as JsonObject;
}

function objectJson(raw: string, label: string): JsonObject {
  return objectValue(parseJson(raw, label), `${label} JSON`);
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new GenerationBasisReadError(`${label}이 배열이 아닙니다.`);
  return value;
}

function arrayJson(raw: string, label: string): readonly unknown[] {
  return arrayValue(parseJson(raw, label), `${label} JSON`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new GenerationBasisReadError(`${label}이 올바르지 않습니다.`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requiredString(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new GenerationBasisReadError(`${label}이 양의 정수가 아닙니다.`);
  return Number(value);
}

function exactOne(value: unknown, label: string): 1 {
  if (positiveInteger(value, label) !== 1) throw new GenerationBasisReadError(`${label}는 1이어야 합니다.`);
  return 1;
}

function literal<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new GenerationBasisReadError(`${label}이 올바르지 않습니다.`);
  return value as T;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function srRef<K extends SrVersionKind>(
  scope: SrScope,
  kind: K,
  entityId: string,
  version: number,
): SrVersionRef<K> {
  return { kind, projectId: scope.projectId, srId: scope.srId, entityId, version };
}

const versionTables: Readonly<Record<SrVersionKind, readonly [string, string]>> = {
  artifact: ['artifact_versions', 'artifact_id'],
  context_source: ['context_source_versions', 'source_id'],
  question_result: ['question_result_snapshots', 'question_id'],
  question_answer: ['question_answer_versions', 'answer_id'],
  decision: ['decision_versions', 'decision_id'],
  scope_classification: ['scope_classification_versions', 'classification_id'],
  sr_description: ['sr_description_versions', 'description_id'],
  review_assignment: ['review_assignment_versions', 'assignment_id'],
  handoff: ['handoffs', 'handoff_id'],
};

function versionRef<K extends SrVersionKind>(
  db: DatabaseConnection,
  scope: SrScope,
  value: unknown,
  expectedKind: K,
  label: string,
): SrVersionRef<K> {
  const candidate = objectValue(value, label);
  if (candidate.kind !== expectedKind) throw new GenerationBasisReadError(`${label} kind가 ${expectedKind}이 아닙니다.`);
  if (candidate.projectId !== scope.projectId || candidate.srId !== scope.srId) {
    throw new GenerationBasisReadError(`${label}가 같은 SR 범위가 아닙니다.`);
  }
  const entityId = requiredString(candidate.entityId, `${label} entityId`);
  const version = positiveInteger(candidate.version, `${label} version`);
  const [table, idColumn] = versionTables[expectedKind];
  const row = db.prepare(
    `SELECT 1 AS found FROM ${table}
      WHERE project_id=? AND sr_id=? AND ${idColumn}=? AND version=? LIMIT 1`,
  ).get(scope.projectId, scope.srId, entityId, version);
  if (row === undefined) throw new GenerationBasisReadError(`${label}가 실제 row와 맞지 않습니다(${expectedKind}).`);
  return srRef(scope, expectedKind, entityId, version);
}

function versionRefs<K extends SrVersionKind>(
  db: DatabaseConnection,
  scope: SrScope,
  value: unknown,
  expectedKind: K,
  label: string,
): readonly SrVersionRef<K>[] {
  return arrayValue(value, label).map((item, index) =>
    versionRef(db, scope, item, expectedKind, `${label}[${index}]`));
}

function anySrVersionRef(
  db: DatabaseConnection,
  scope: SrScope,
  value: unknown,
  label: string,
): SrVersionRef {
  const candidate = objectValue(value, label);
  const kind = candidate.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(versionTables, kind)) {
    throw new GenerationBasisReadError(`${label} kind가 알려진 SR version kind가 아닙니다.`);
  }
  return versionRef(db, scope, candidate, kind as SrVersionKind, label);
}

function evidenceRef(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): EvidenceRef {
  const candidate = objectValue(value, label);
  if (candidate.kind === 'external') {
    return {
      kind: 'external',
      label: requiredString(candidate.label, `${label} label`),
      ...(candidate.url === undefined ? {} : { url: requiredString(candidate.url, `${label} url`) }),
      verificationSummary: requiredString(candidate.verificationSummary, `${label} verificationSummary`),
    };
  }
  if (candidate.kind === 'review_policy') {
    if (candidate.projectId !== scope.projectId || candidate.srId !== undefined) {
      throw new GenerationBasisReadError(`${label} review policy 범위가 올바르지 않습니다.`);
    }
    const entityId = requiredString(candidate.entityId, `${label} entityId`);
    const version = positiveInteger(candidate.version, `${label} version`);
    const row = db.prepare(
      'SELECT 1 AS found FROM review_policy_versions WHERE project_id=? AND policy_id=? AND version=? LIMIT 1',
    ).get(scope.projectId, entityId, version);
    if (row === undefined) throw new GenerationBasisReadError(`${label}가 실제 review policy row와 맞지 않습니다.`);
    return { kind: 'review_policy', projectId: scope.projectId, entityId, version };
  }
  return anySrVersionRef(db, scope, candidate, label);
}

function storedVersionRef(
  db: DatabaseConnection,
  scope: SrScope,
  value: unknown,
  label: string,
): VersionRef {
  const candidate = objectValue(value, label);
  if (candidate.kind === 'review_policy') {
    const parsed = evidenceRef(db, scope, candidate, label);
    if (parsed.kind !== 'review_policy') throw new GenerationBasisReadError(`${label}가 version ref가 아닙니다.`);
    return parsed;
  }
  return anySrVersionRef(db, scope, candidate, label);
}

function evidenceRefs(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): readonly EvidenceRef[] {
  return arrayValue(value, label).map((item, index) => evidenceRef(db, scope, item, `${label}[${index}]`));
}

function evidence(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): GenerationEvidence {
  const candidate = objectValue(value, label);
  if (Object.hasOwn(candidate, 'text')) return { text: requiredString(candidate.text, `${label} text`) };
  if (Object.hasOwn(candidate, 'refs')) return { refs: evidenceRefs(db, scope, candidate.refs, `${label} refs`) };
  throw new GenerationBasisReadError(`${label}가 text 또는 refs 근거가 아닙니다.`);
}

function targetRef(
  db: DatabaseConnection,
  scope: SrScope,
  kindValue: unknown,
  idValue: unknown,
): EntityRef<'question' | 'decision'> {
  const kind = literal(kindValue, ['question', 'decision'] as const, '분류 target kind');
  const entityId = requiredString(idValue, '분류 target ID');
  const table = kind === 'question' ? 'questions' : 'decisions';
  const idColumn = kind === 'question' ? 'question_id' : 'decision_id';
  const row = db.prepare(
    `SELECT 1 AS found FROM ${table} WHERE project_id=? AND sr_id=? AND ${idColumn}=? LIMIT 1`,
  ).get(scope.projectId, scope.srId, entityId);
  if (row === undefined) throw new GenerationBasisReadError(`분류 target이 실제 ${kind} row와 맞지 않습니다.`);
  return { kind, projectId: scope.projectId, srId: scope.srId, entityId };
}

function options(value: unknown, label: string): readonly { readonly optionId: string; readonly text: string }[] {
  return arrayValue(value, label).map((item, index) => {
    const option = objectValue(item, `${label}[${index}]`);
    return {
      optionId: requiredString(option.optionId, `${label}[${index}].optionId`),
      text: requiredString(option.text, `${label}[${index}].text`),
    };
  });
}

function alternatives(value: unknown, label: string): readonly DecisionAlternative[] {
  return arrayValue(value, label).map((item, index) => {
    const alternative = objectValue(item, `${label}[${index}]`);
    return {
      optionId: requiredString(alternative.optionId, `${label}[${index}].optionId`),
      label: requiredString(alternative.label, `${label}[${index}].label`),
      description: requiredString(alternative.description, `${label}[${index}].description`),
    };
  });
}

function sections(value: unknown, label: string): readonly SectionIndexEntry[] {
  return arrayValue(value, label).map((item, index) => {
    const section = objectValue(item, `${label}[${index}]`);
    const startOffset = Number(section.startOffset);
    const endOffset = Number(section.endOffset);
    if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset) {
      throw new GenerationBasisReadError(`${label}[${index}] offset이 올바르지 않습니다.`);
    }
    return {
      sectionId: requiredString(section.sectionId, `${label}[${index}].sectionId`),
      title: requiredString(section.title, `${label}[${index}].title`),
      startOffset,
      endOffset,
    };
  });
}

function stringArray(value: unknown, label: string, nonEmpty = false): readonly string[] {
  const result = arrayValue(value, label).map((item, index) => requiredString(item, `${label}[${index}]`));
  if (nonEmpty && result.length === 0) throw new GenerationBasisReadError(`${label}이 비어 있습니다.`);
  return result;
}

function requirementLinks(value: unknown, label: string): readonly RequirementLink[] {
  return arrayValue(value, label).map((item, index) => {
    const link = objectValue(item, `${label}[${index}]`);
    const sectionIds = stringArray(link.sectionIds, `${label}[${index}].sectionIds`, true);
    return {
      requirementId: requiredString(link.requirementId, `${label}[${index}].requirementId`),
      sectionIds: sectionIds as RequirementLink['sectionIds'],
      acceptanceCriteria: stringArray(link.acceptanceCriteria, `${label}[${index}].acceptanceCriteria`),
    };
  });
}

function workflowStages(
  db: DatabaseConnection,
  scope: SrScope,
  value: unknown,
): readonly WorkflowStageInput[] {
  return arrayValue(value, 'workflow stages').map((item, index) => {
    const stage = objectValue(item, `workflow stages[${index}]`);
    const stageId = requiredString(stage.stageId, `workflow stages[${index}].stageId`);
    const choice = literal(stage.choice, ['executed', 'skipped'] as const, `workflow stages[${index}].choice`);
    if (choice === 'executed') {
      return {
        stageId,
        choice,
        designArtifactRefs: versionRefs(db, scope, stage.designArtifactRefs, 'artifact', `workflow stages[${index}].designArtifactRefs`),
      };
    }
    return { stageId, choice, reason: requiredString(stage.reason, `workflow stages[${index}].reason`) };
  });
}

function taskLinks(value: unknown): readonly RequirementTaskLink[] {
  return arrayValue(value, 'workflow 요구사항 작업 연결').map((item, index) => {
    const link = objectValue(item, `workflow 요구사항 작업 연결[${index}]`);
    const requirementIds = stringArray(link.requirementIds, 'requirementIds', true);
    const verification = stringArray(link.verification, 'verification', true);
    return {
      taskId: requiredString(link.taskId, 'taskId'),
      requirementIds: requirementIds as RequirementTaskLink['requirementIds'],
      verification: verification as RequirementTaskLink['verification'],
      order: positiveInteger(link.order, 'order'),
    };
  });
}

function payloadRefs<K extends SrVersionKind>(
  db: DatabaseConnection,
  scope: SrScope,
  payload: JsonObject,
  field: string,
  expectedKind: K,
): readonly SrVersionRef<K>[] {
  if (!Object.hasOwn(payload, field)) return [];
  return versionRefs(db, scope, payload[field], expectedKind, `문서 ${field}`);
}

export function readGenerationBasis(db: DatabaseConnection, scope: SrScope): GenerationBasis | undefined {
  const sr = db.prepare(
    `SELECT s.owner_id,s.workflow_version,s.current_description_id,s.current_description_version,
            d.title,d.purpose,d.description,d.payload_json
       FROM srs s JOIN sr_description_versions d
         ON d.project_id=s.project_id AND d.sr_id=s.sr_id
        AND d.description_id=s.current_description_id AND d.version=s.current_description_version
      WHERE s.project_id=? AND s.sr_id=?`,
  ).get(scope.projectId, scope.srId) as Record<string, unknown> | undefined;
  if (sr === undefined) return undefined;
  objectJson(String(sr.payload_json), '현재 설명 payload');
  const workflowVersion = literal(sr.workflow_version, ['v1.0.1'] as const, 'workflow version');
  const ownerId = requiredString(sr.owner_id, 'SR owner ID');
  const members = (db.prepare(
    `SELECT user_id,display_name FROM demo_user_memberships
      WHERE project_id=?`,
  ).all(scope.projectId) as Array<Record<string, unknown>>)
    .map((row) => ({
      userId: requiredString(row.user_id, 'member user ID'),
      displayName: requiredString(row.display_name, 'member display name'),
    }))
    .sort((left, right) => compareCodeUnits(left.userId, right.userId));
  if (!members.some((member) => member.userId === ownerId)) {
    throw new GenerationBasisReadError('SR owner가 현재 프로젝트 member가 아닙니다.');
  }
  const participants: GenerationParticipants = { ownerId, members };

  const sources = readContextSources(db, scope.projectId, scope.srId).map(generationSourceBasis);

  const classificationRows = db.prepare(
    `SELECT c.* FROM scope_classification_versions c
      WHERE c.project_id=? AND c.sr_id=? AND (
        EXISTS (SELECT 1 FROM questions q JOIN question_result_snapshots r
          ON r.project_id=q.project_id AND r.sr_id=q.sr_id AND r.question_id=q.question_id
         AND r.version=q.current_result_version WHERE q.project_id=c.project_id AND q.sr_id=c.sr_id
         AND r.classification_id=c.classification_id AND r.classification_version=c.version)
        OR EXISTS (SELECT 1 FROM decisions d WHERE d.project_id=c.project_id AND d.sr_id=c.sr_id
          AND d.classification_id=c.classification_id AND d.classification_version=c.version)
        OR EXISTS (SELECT 1 FROM decisions d JOIN decision_versions v
          ON v.project_id=d.project_id AND v.sr_id=d.sr_id AND v.decision_id=d.decision_id
         AND v.version=d.current_confirmed_version WHERE d.project_id=c.project_id AND d.sr_id=c.sr_id
         AND v.classification_id=c.classification_id AND v.classification_version=c.version)
      ) ORDER BY c.classification_id,c.version`,
  ).all(scope.projectId, scope.srId) as Array<Record<string, unknown>>;
  const classifications = classificationRows.map((row): GenerationClassificationBasis => {
    const payload = objectJson(String(row.payload_json), '분류 payload');
    const target = targetRef(db, scope, row.target_kind, row.target_id);
    if (Object.hasOwn(payload, 'targetRef')) {
      const stored = objectValue(payload.targetRef, '분류 targetRef');
      if (stored.kind !== target.kind || stored.projectId !== target.projectId || stored.srId !== target.srId || stored.entityId !== target.entityId) {
        throw new GenerationBasisReadError('분류 targetRef가 현재 분류 대상과 맞지 않습니다.');
      }
    }
    const basisRefs = Object.hasOwn(payload, 'basisRefs')
      ? arrayValue(payload.basisRefs, '분류 basisRefs').map((item, index) => storedVersionRef(db, scope, item, `분류 basisRefs[${index}]`))
      : [];
    return {
      ref: srRef(scope, 'scope_classification', requiredString(row.classification_id, 'classification ID'), positiveInteger(row.version, 'classification version')),
      target,
      scope: literal(row.scope, ['current', 'followup'] as const, 'classification scope'),
      requiredGate: literal(row.required_gate, ['G1', 'G2', 'None'] as const, 'classification gate'),
      reason: requiredString(row.reason, 'classification reason'),
      ownerId: nullableString(row.owner_id, 'classification owner'),
      revisitAt: nullableString(row.revisit_at, 'classification revisitAt'),
      revisitEvent: nullableString(row.revisit_event, 'classification revisitEvent'),
      basisRefs,
    };
  });

  const questionRows = db.prepare(
    `SELECT q.question_id,q.status,q.current_result_version,q.converted_decision_id,r.text,r.reason,r.assignee_id,
            r.answer_mode,r.options_json,r.classification_id,r.classification_version,
            r.evidence_refs_json,r.selected_answer_id,r.selected_answer_version,r.payload_json
       FROM questions q JOIN question_result_snapshots r
         ON r.project_id=q.project_id AND r.sr_id=q.sr_id AND r.question_id=q.question_id
        AND r.version=q.current_result_version
      WHERE q.project_id=? AND q.sr_id=? ORDER BY q.question_id`,
  ).all(scope.projectId, scope.srId) as Array<Record<string, unknown>>;
  const questions = questionRows.map((row): GenerationQuestionBasis => {
    const questionId = requiredString(row.question_id, 'question ID');
    const payload = objectJson(String(row.payload_json), '질문 결과 payload');
    const classificationRef = srRef(scope, 'scope_classification', requiredString(row.classification_id, 'question classification ID'), positiveInteger(row.classification_version, 'question classification version'));
    versionRef(db, scope, classificationRef, 'scope_classification', '질문 classificationRef');
    if (Object.hasOwn(payload, 'classificationRef')) {
      versionRef(db, scope, payload.classificationRef, 'scope_classification', '질문 payload classificationRef');
    }
    let selectedAnswer: GenerationAnswerBasis | null = null;
    if (row.selected_answer_id !== null && row.selected_answer_version !== null) {
      const answer = db.prepare(
        `SELECT answer_text,evidence_json,answered_by,selected_option_id,payload_json
           FROM question_answer_versions
          WHERE project_id=? AND sr_id=? AND question_id=? AND answer_id=? AND version=?`,
      ).get(scope.projectId, scope.srId, questionId, row.selected_answer_id, row.selected_answer_version) as Record<string, unknown> | undefined;
      if (answer === undefined) throw new GenerationBasisReadError('선택 답변 참조가 실제 row와 맞지 않습니다.');
      objectJson(String(answer.payload_json), '선택 답변 payload');
      selectedAnswer = {
        ref: srRef(scope, 'question_answer', requiredString(row.selected_answer_id, 'answer ID'), positiveInteger(row.selected_answer_version, 'answer version')),
        answerText: requiredString(answer.answer_text, 'answer text'),
        selectedOptionId: nullableString(answer.selected_option_id, 'selected option ID'),
        evidence: evidence(db, scope, parseJson(String(answer.evidence_json), '선택 답변 근거'), '선택 답변 근거'),
        answeredBy: requiredString(answer.answered_by, 'answer actor'),
      };
    }
    let resolution: GenerationQuestionResolutionBasis | null = null;
    if (Object.hasOwn(payload, 'resolution')) {
      const stored = objectValue(payload.resolution, '질문 해결 확인');
      const selectedAnswerRef = versionRef(
        db, scope, stored.selectedAnswerRef, 'question_answer', '질문 해결 selectedAnswerRef',
      );
      const disposition = objectValue(stored.documentDisposition, '질문 해결 문서 반영');
      let documentDisposition: GenerationQuestionResolutionBasis['documentDisposition'];
      if (disposition.kind === 'reflected') {
        const artifactVersionRefs = versionRefs(
          db, scope, disposition.artifactVersionRefs, 'artifact', '질문 해결 artifactVersionRefs',
        );
        if (artifactVersionRefs.length === 0) throw new GenerationBasisReadError('질문 해결 문서 참조가 비었습니다.');
        documentDisposition = { kind: 'reflected', artifactVersionRefs };
      } else if (disposition.kind === 'not_required') {
        documentDisposition = {
          kind: 'not_required',
          reason: requiredString(disposition.reason, '질문 해결 문서 불필요 이유'),
        };
      } else {
        throw new GenerationBasisReadError('질문 해결 문서 반영 상태가 올바르지 않습니다.');
      }
      resolution = {
        selectedAnswerRef,
        evidence: evidence(db, scope, stored.evidence, '질문 해결 근거'),
        documentDisposition,
        resolvedBy: requiredString(stored.resolvedBy, '질문 해결 actor'),
        resolvedAt: requiredString(stored.resolvedAt, '질문 해결 시각'),
      };
    }
    const status = literal(row.status, ['open', 'answered', 'resolved', 'converted_to_decision'] as const, 'question status');
    if (status === 'resolved' && (selectedAnswer === null || resolution === null ||
      resolution.selectedAnswerRef.entityId !== selectedAnswer.ref.entityId ||
      resolution.selectedAnswerRef.version !== selectedAnswer.ref.version)) {
      throw new GenerationBasisReadError('resolved 질문의 해결 근거가 현재 답변과 다릅니다.');
    }
    if (status !== 'resolved' && resolution !== null) {
      throw new GenerationBasisReadError('resolved가 아닌 질문에 해결 근거가 있습니다.');
    }
    const convertedDecisionId = nullableString(row.converted_decision_id, 'converted decision ID');
    if ((status === 'converted_to_decision') !== (convertedDecisionId !== null)) {
      throw new GenerationBasisReadError('converted 질문의 decision 연결이 올바르지 않습니다.');
    }
    if (convertedDecisionId !== null && db.prepare(
      `SELECT 1 FROM decisions
        WHERE project_id=? AND sr_id=? AND decision_id=? AND origin_question_id=?`,
    ).get(scope.projectId, scope.srId, convertedDecisionId, questionId) === undefined) {
      throw new GenerationBasisReadError('converted 질문과 origin decision 연결이 서로 다릅니다.');
    }
    return {
      resultRef: srRef(scope, 'question_result', questionId, positiveInteger(row.current_result_version, 'question result version')),
      questionId,
      text: requiredString(row.text, 'question text'),
      reason: requiredString(row.reason, 'question reason'),
      assigneeId: requiredString(row.assignee_id, 'question assignee'),
      answerMode: literal(row.answer_mode, ['choice', 'free_text'] as const, 'question answer mode'),
      options: options(parseJson(String(row.options_json), '질문 선택지'), '질문 선택지'),
      status,
      classificationRef,
      evidenceRefs: evidenceRefs(db, scope, parseJson(String(row.evidence_refs_json), '질문 근거 참조'), '질문 근거 참조'),
      candidateAnswers: Object.hasOwn(payload, 'candidateAnswers') ? stringArray(payload.candidateAnswers, '질문 candidateAnswers') : [],
      selectedAnswer,
      resolution,
      convertedDecisionId,
    };
  });

  const decisionRows = db.prepare(
    `SELECT decision_id,prompt,alternatives_json,impact,decision_maker_id,origin_question_id,
            classification_id,classification_version,current_confirmed_version,payload_json
       FROM decisions WHERE project_id=? AND sr_id=? ORDER BY decision_id`,
  ).all(scope.projectId, scope.srId) as Array<Record<string, unknown>>;
  const decisions = decisionRows.map((row): GenerationDecisionBasis => {
    const definitionPayload = objectJson(String(row.payload_json), '결정 정의 payload');
    const decisionId = requiredString(row.decision_id, 'decision ID');
    const originQuestionId = nullableString(row.origin_question_id, 'origin question ID');
    const originQuestionResultSnapshotRef = Object.hasOwn(definitionPayload, 'originQuestionResultSnapshotRef')
      ? versionRef(db, scope, definitionPayload.originQuestionResultSnapshotRef, 'question_result', 'origin question result ref')
      : null;
    if ((originQuestionId === null) !== (originQuestionResultSnapshotRef === null) ||
      (originQuestionId !== null && originQuestionResultSnapshotRef?.entityId !== originQuestionId)) {
      throw new GenerationBasisReadError('origin question과 result snapshot 연결이 올바르지 않습니다.');
    }
    if (originQuestionId !== null && db.prepare(
      `SELECT 1 FROM questions
        WHERE project_id=? AND sr_id=? AND question_id=?
          AND status='converted_to_decision' AND converted_decision_id=?`,
    ).get(scope.projectId, scope.srId, originQuestionId, decisionId) === undefined) {
      throw new GenerationBasisReadError('origin decision과 converted 질문 연결이 서로 다릅니다.');
    }
    const definition = {
      decisionId,
      prompt: requiredString(row.prompt, 'decision prompt'),
      alternatives: alternatives(parseJson(String(row.alternatives_json), '결정 대안'), '결정 대안'),
      impact: requiredString(row.impact, 'decision impact'),
      decisionMakerId: requiredString(row.decision_maker_id, 'decision maker'),
      classificationRef: srRef(scope, 'scope_classification', requiredString(row.classification_id, 'decision classification ID'), positiveInteger(row.classification_version, 'decision classification version')),
      originQuestionId,
      originQuestionResultSnapshotRef,
    };
    versionRef(db, scope, definition.classificationRef, 'scope_classification', '결정 classificationRef');
    if (row.current_confirmed_version === null) return { definition, currentVersion: null };
    const currentVersionNumber = positiveInteger(row.current_confirmed_version, 'decision current version');
    const version = db.prepare(
      `SELECT prompt,alternatives_json,impact,selected_option,rationale,evidence_json,
              decision_maker_id,classification_id,classification_version,previous_version,change_reason,payload_json
         FROM decision_versions
        WHERE project_id=? AND sr_id=? AND decision_id=? AND version=?`,
    ).get(scope.projectId, scope.srId, decisionId, currentVersionNumber) as Record<string, unknown> | undefined;
    if (version === undefined) throw new GenerationBasisReadError('현재 결정 참조가 실제 row와 맞지 않습니다.');
    const payload = objectJson(String(version.payload_json), '결정 버전 payload');
    const versionOriginQuestionId = Object.hasOwn(payload, 'originQuestionId')
      ? requiredString(payload.originQuestionId, '결정 버전 origin question ID') : null;
    const versionOriginQuestionResultSnapshotRef = Object.hasOwn(payload, 'originQuestionResultSnapshotRef')
      ? versionRef(db, scope, payload.originQuestionResultSnapshotRef, 'question_result', '결정 버전 origin result ref')
      : null;
    if (versionOriginQuestionId !== originQuestionId ||
      (versionOriginQuestionResultSnapshotRef === null) !== (originQuestionResultSnapshotRef === null) ||
      (versionOriginQuestionResultSnapshotRef !== null && originQuestionResultSnapshotRef !== null && (
        versionOriginQuestionResultSnapshotRef.kind !== originQuestionResultSnapshotRef.kind ||
        versionOriginQuestionResultSnapshotRef.projectId !== originQuestionResultSnapshotRef.projectId ||
        versionOriginQuestionResultSnapshotRef.srId !== originQuestionResultSnapshotRef.srId ||
        versionOriginQuestionResultSnapshotRef.entityId !== originQuestionResultSnapshotRef.entityId ||
        versionOriginQuestionResultSnapshotRef.version !== originQuestionResultSnapshotRef.version
      ))) {
      throw new GenerationBasisReadError('결정 버전의 origin question 근거가 정의와 다릅니다.');
    }
    const artifactVersionRefs = Object.hasOwn(payload, 'artifactVersionRefs')
      ? versionRefs(db, scope, payload.artifactVersionRefs, 'artifact', '결정 artifactVersionRefs')
      : [];
    return {
      definition,
      currentVersion: {
        ref: srRef(scope, 'decision', decisionId, currentVersionNumber),
        prompt: requiredString(version.prompt, 'decision version prompt'),
        alternatives: alternatives(parseJson(String(version.alternatives_json), '결정 버전 대안'), '결정 버전 대안'),
        impact: requiredString(version.impact, 'decision version impact'),
        selectedOption: requiredString(version.selected_option, 'decision selection'),
        rationale: requiredString(version.rationale, 'decision rationale'),
        evidence: evidence(db, scope, parseJson(String(version.evidence_json), '결정 근거'), '결정 근거'),
        decisionMakerId: requiredString(version.decision_maker_id, 'decision version maker'),
        classificationRef: versionRef(db, scope, srRef(scope, 'scope_classification', requiredString(version.classification_id, 'decision version classification ID'), positiveInteger(version.classification_version, 'decision version classification version')), 'scope_classification', '결정 버전 classificationRef'),
        originQuestionId: versionOriginQuestionId,
        originQuestionResultSnapshotRef: versionOriginQuestionResultSnapshotRef,
        affectedRequirementIds: Object.hasOwn(payload, 'affectedRequirements') ? stringArray(payload.affectedRequirements, '결정 affectedRequirements') : [],
        artifactVersionRefs,
        previousVersionRef: version.previous_version === null
          ? null
          : srRef(scope, 'decision', decisionId, positiveInteger(version.previous_version, 'previous decision version')),
        changeReason: nullableString(version.change_reason, 'decision change reason'),
      },
    };
  });

  const artifactRows = db.prepare(
    `SELECT a.artifact_id,a.kind,a.current_version,a.design_stage,v.markdown,
            v.section_index_json,v.requirement_links_json,v.payload_json,
            w.workflow_version AS plan_workflow_version,w.stages_json,
            w.implementation_unit_count,w.requirement_task_links_json
       FROM artifacts a JOIN artifact_versions v
         ON v.project_id=a.project_id AND v.sr_id=a.sr_id AND v.artifact_id=a.artifact_id
        AND v.kind=a.kind AND v.version=a.current_version
       LEFT JOIN workflow_plan_versions w
         ON w.project_id=v.project_id AND w.sr_id=v.sr_id AND w.artifact_id=v.artifact_id
        AND w.artifact_kind=v.kind AND w.version=v.version
      WHERE a.project_id=? AND a.sr_id=? ORDER BY a.kind,a.artifact_id`,
  ).all(scope.projectId, scope.srId) as Array<Record<string, unknown>>;
  const artifacts = artifactRows.map((row): GenerationArtifactBasis => {
    const kind = literal(row.kind, ['requirements', 'workflow_plan', 'design', 'implementation_plan'] as const, 'artifact kind');
    let target: ReturnType<typeof artifactLogicalTarget>;
    try {
      target = artifactLogicalTarget(
        kind,
        row.design_stage === null ? null : requiredString(row.design_stage, 'artifact design stage'),
      );
    } catch (error) {
      throw new GenerationBasisReadError(
        error instanceof Error ? error.message : 'artifact logical target이 올바르지 않습니다.',
      );
    }
    const payload = objectJson(String(row.payload_json), '문서 payload');
    const common = {
      ref: srRef(scope, 'artifact', requiredString(row.artifact_id, 'artifact ID'), positiveInteger(row.current_version, 'artifact version')),
      kind,
      ...(target.designStage === undefined ? {} : { designStage: target.designStage }),
      logicalKey: target.logicalKey,
      markdown: requiredString(row.markdown, 'artifact markdown'),
      sectionIndex: sections(parseJson(String(row.section_index_json), '문서 section index'), '문서 section index'),
      requirementLinks: requirementLinks(parseJson(String(row.requirement_links_json), '문서 요구사항 연결'), '문서 요구사항 연결'),
      decisionRefs: payloadRefs(db, scope, payload, 'decisionRefs', 'decision'),
      sourceRefs: payloadRefs(db, scope, payload, 'sourceRefs', 'context_source'),
      questionResultRefs: payloadRefs(db, scope, payload, 'questionResultRefs', 'question_result'),
    };
    if (kind !== 'workflow_plan') return common;
    if (row.plan_workflow_version === null || row.stages_json === null || row.requirement_task_links_json === null) {
      throw new GenerationBasisReadError('workflow plan의 필수 구조가 없습니다.');
    }
    return {
      ...common,
      workflowPlan: {
        workflowVersion: literal(row.plan_workflow_version, ['v1.0.1'] as const, 'plan workflow version'),
        stages: workflowStages(db, scope, parseJson(String(row.stages_json), 'workflow stages')),
        implementationUnitCount: exactOne(row.implementation_unit_count, 'implementation unit count'),
        requirementTaskLinks: taskLinks(parseJson(String(row.requirement_task_links_json), 'workflow 요구사항 작업 연결')),
      },
    };
  });

  return {
    scope,
    workflowVersion,
    participants,
    currentDescription: {
      ref: srRef(scope, 'sr_description', requiredString(sr.current_description_id, 'description ID'), positiveInteger(sr.current_description_version, 'description version')),
      title: requiredString(sr.title, 'description title'),
      purpose: requiredString(sr.purpose, 'description purpose'),
      description: requiredString(sr.description, 'description body'),
    },
    sources,
    questions,
    decisions,
    classifications,
    artifacts,
  };
}
