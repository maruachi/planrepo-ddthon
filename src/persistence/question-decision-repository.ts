import { randomUUID } from 'node:crypto';
import type {
  ArtifactVersionRef,
  DecisionVersionRef,
  EntityRef,
  EvidenceRef,
  QuestionAnswerVersionRef,
  QuestionResultSnapshotRef,
  ScopeClassificationRef,
  SrScope,
  SrVersionKind,
  UserId,
  VersionRef,
} from '@/src/contracts/context';
import type {
  DecisionConfirmation,
  DecisionConversion,
  DecisionProposal,
  DecisionRevision,
  DecisionView,
  DraftEntityMapping,
  FollowupQuestion,
  QuestionAnswer,
  QuestionClassificationInput,
  QuestionProposal,
  QuestionResolution,
  QuestionView,
  ScopeClassification,
  ScopeView,
} from '@/src/contracts/views';
import type {
  CurrentScopeClassificationContent,
  DecisionAlternativeContent,
  DecisionContentFields,
  QAnswerContent,
  QContentFields,
  QStoredEvidence,
} from '@/src/contracts/question-decision-content';
import type { ReviewImpact } from '@/src/contracts/results';
import type { DatabaseConnection } from '@/src/persistence/database';

type JsonObject = Readonly<Record<string, unknown>>;

export class QuestionDecisionRepositoryError extends Error {
  constructor(
    readonly code: 'CORRUPT_DATA' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'QuestionDecisionRepositoryError';
  }
}

export type StoredQuestionView = QuestionView & QContentFields;
export type StoredDecisionView = DecisionView & DecisionContentFields;

export interface DecisionDraftSelection {
  readonly proposal: DecisionProposal;
  readonly decisionMakerId: UserId;
  readonly classification: QuestionClassificationInput;
}

interface QuestionRow extends Record<string, unknown> {
  readonly question_id: string;
  readonly text: string;
  readonly reason: string;
  readonly assignee_id: string;
  readonly answer_mode: 'choice' | 'free_text';
  readonly required_gate: 'G1' | 'G2' | 'None';
  readonly classification_id: string;
  readonly classification_version: number;
  readonly status: QuestionView['status'];
  readonly current_result_version: number;
  readonly revision: number;
  readonly created_at: string;
  readonly parent_question_id: string | null;
  readonly converted_decision_id: string | null;
  readonly payload_json: string;
  readonly result_text: string;
  readonly result_reason: string;
  readonly result_assignee_id: string;
  readonly result_answer_mode: 'choice' | 'free_text';
  readonly options_json: string;
  readonly result_status: QuestionView['status'];
  readonly result_classification_id: string;
  readonly result_classification_version: number;
  readonly evidence_refs_json: string;
  readonly captured_at: string;
  readonly selected_answer_id: string | null;
  readonly selected_answer_version: number | null;
  readonly result_payload_json: string;
}

interface DecisionRow extends Record<string, unknown> {
  readonly decision_id: string;
  readonly prompt: string;
  readonly alternatives_json: string;
  readonly impact: string;
  readonly decision_maker_id: string;
  readonly classification_id: string;
  readonly classification_version: number;
  readonly revision: number;
  readonly created_by: string;
  readonly created_at: string;
  readonly current_confirmed_version: number | null;
  readonly origin_question_id: string | null;
  readonly payload_json: string;
}

const VERSION_TABLES: Readonly<Record<SrVersionKind, readonly [string, string]>> = {
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

function corrupt(message: string): never {
  throw new QuestionDecisionRepositoryError('CORRUPT_DATA', message);
}

function invalid(message: string): never {
  throw new QuestionDecisionRepositoryError('INVALID_INPUT', message);
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return corrupt(`${label}가 객체가 아닙니다.`);
  }
  return value as JsonObject;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return corrupt(`${label} JSON이 올바르지 않습니다.`);
  }
}

function objectJson(raw: string, label: string): JsonObject {
  return objectValue(parseJson(raw, label), `${label} JSON`);
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) return corrupt(`${label}가 배열이 아닙니다.`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) return corrupt(`${label}이 올바르지 않습니다.`);
  return value;
}

function inputString(value: string, label: string): string {
  if (value.trim().length === 0) return invalid(`${label}이 비어 있습니다.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return corrupt(`${label}이 양의 정수가 아닙니다.`);
  }
  return value;
}

function noImpact(): ReviewImpact {
  return {
    affectedGates: [],
    needsNewReview: false,
    carriedBlockingRequestIds: [],
    currentHandoffValid: true,
  };
}

function memberExists(db: DatabaseConnection, projectId: string, userId: string): boolean {
  return db.prepare(
    'SELECT 1 AS found FROM demo_user_memberships WHERE project_id=? AND user_id=? LIMIT 1',
  ).get(projectId, userId) !== undefined;
}

function requireInputMember(db: DatabaseConnection, projectId: string, userId: string, label: string): void {
  inputString(userId, label);
  if (!memberExists(db, projectId, userId)) invalid(`${label}가 현재 프로젝트 member가 아닙니다.`);
}

function classificationRef(scope: SrScope, entityId: string, version: number): ScopeClassificationRef {
  return { kind: 'scope_classification', projectId: scope.projectId, srId: scope.srId, entityId, version };
}

function questionResultRef(scope: SrScope, questionId: string, version: number): QuestionResultSnapshotRef {
  return { kind: 'question_result', projectId: scope.projectId, srId: scope.srId, entityId: questionId, version };
}

function questionAnswerRef(scope: SrScope, answerId: string, version: number): QuestionAnswerVersionRef {
  return { kind: 'question_answer', projectId: scope.projectId, srId: scope.srId, entityId: answerId, version };
}

function decisionVersionRef(scope: SrScope, decisionId: string, version: number): DecisionVersionRef {
  return { kind: 'decision', projectId: scope.projectId, srId: scope.srId, entityId: decisionId, version };
}

function questionEntityRef(scope: SrScope, entityId: string): EntityRef<'question'> {
  return { kind: 'question', projectId: scope.projectId, srId: scope.srId, entityId };
}

function decisionEntityRef(scope: SrScope, entityId: string): EntityRef<'decision'> {
  return { kind: 'decision', projectId: scope.projectId, srId: scope.srId, entityId };
}

function parseVersionRef(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): VersionRef {
  const item = objectValue(value, label);
  const kind = requiredString(item.kind, `${label} kind`);
  const projectId = requiredString(item.projectId, `${label} projectId`);
  const entityId = requiredString(item.entityId, `${label} entityId`);
  const version = positiveInteger(item.version, `${label} version`);
  if (kind === 'review_policy') {
    if (projectId !== scope.projectId || item.srId !== undefined) return corrupt(`${label} scope가 다릅니다.`);
    if (db.prepare(
      'SELECT 1 FROM review_policy_versions WHERE project_id=? AND policy_id=? AND version=?',
    ).get(projectId, entityId, version) === undefined) return corrupt(`${label}의 실제 row가 없습니다.`);
    return { kind, projectId, entityId, version };
  }
  if (!Object.hasOwn(VERSION_TABLES, kind)) return corrupt(`${label} kind가 알려지지 않았습니다.`);
  if (projectId !== scope.projectId || item.srId !== scope.srId) return corrupt(`${label} scope가 다릅니다.`);
  const typedKind = kind as SrVersionKind;
  const [table, idColumn] = VERSION_TABLES[typedKind];
  if (db.prepare(
    `SELECT 1 FROM ${table} WHERE project_id=? AND sr_id=? AND ${idColumn}=? AND version=? LIMIT 1`,
  ).get(projectId, scope.srId, entityId, version) === undefined) {
    return corrupt(`${label}의 실제 row가 없습니다.`);
  }
  return { kind: typedKind, projectId, srId: scope.srId, entityId, version };
}

function parseVersionRefs(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): readonly VersionRef[] {
  return arrayValue(value, label).map((item, index) => parseVersionRef(db, scope, item, `${label}[${index}]`));
}

function parseEvidenceRef(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): EvidenceRef {
  const item = objectValue(value, label);
  if (item.kind !== 'external') return parseVersionRef(db, scope, item, label);
  return {
    kind: 'external',
    label: requiredString(item.label, `${label} label`),
    ...(item.url === undefined ? {} : { url: requiredString(item.url, `${label} url`) }),
    verificationSummary: requiredString(item.verificationSummary, `${label} verificationSummary`),
  };
}

function parseEvidenceRefs(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): readonly EvidenceRef[] {
  return arrayValue(value, label).map((item, index) => parseEvidenceRef(db, scope, item, `${label}[${index}]`));
}

function parseEvidence(db: DatabaseConnection, scope: SrScope, raw: string, label: string): QStoredEvidence {
  const item = objectValue(parseJson(raw, label), label);
  if (Object.hasOwn(item, 'text')) return { text: requiredString(item.text, `${label} text`) };
  if (Object.hasOwn(item, 'refs')) return { refs: parseEvidenceRefs(db, scope, item.refs, `${label} refs`) };
  return corrupt(`${label}가 text 또는 refs 근거가 아닙니다.`);
}

function stringArray(value: unknown, label: string): readonly string[] {
  return arrayValue(value, label).map((item, index) => requiredString(item, `${label}[${index}]`));
}

function options(value: unknown, label: string): readonly { readonly optionId: string; readonly text: string }[] {
  return arrayValue(value, label).map((entry, index) => {
    const item = objectValue(entry, `${label}[${index}]`);
    return {
      optionId: requiredString(item.optionId, `${label}[${index}].optionId`),
      text: requiredString(item.text, `${label}[${index}].text`),
    };
  });
}

function alternatives(value: unknown, label: string): readonly DecisionAlternativeContent[] {
  return arrayValue(value, label).map((entry, index) => {
    const item = objectValue(entry, `${label}[${index}]`);
    return {
      optionId: requiredString(item.optionId, `${label}[${index}].optionId`),
      label: requiredString(item.label, `${label}[${index}].label`),
      description: requiredString(item.description, `${label}[${index}].description`),
    };
  });
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : requiredString(value, label);
}

function parseArtifactRefs(db: DatabaseConnection, scope: SrScope, value: unknown, label: string): readonly ArtifactVersionRef[] {
  return parseVersionRefs(db, scope, value, label).map((ref) => {
    if (ref.kind !== 'artifact' || !('srId' in ref)) return corrupt(`${label}에 artifact가 아닌 ref가 있습니다.`);
    return {
      kind: 'artifact', projectId: ref.projectId, srId: ref.srId,
      entityId: ref.entityId, version: ref.version,
    };
  });
}

function questionRow(db: DatabaseConnection, scope: SrScope, questionId: string): QuestionRow | undefined {
  return db.prepare(
    `SELECT q.*,
            r.text AS result_text,r.reason AS result_reason,r.assignee_id AS result_assignee_id,
            r.answer_mode AS result_answer_mode,r.options_json,r.status AS result_status,
            r.classification_id AS result_classification_id,
            r.classification_version AS result_classification_version,
            r.evidence_refs_json,r.captured_at,r.selected_answer_id,r.selected_answer_version,
            r.payload_json AS result_payload_json
       FROM questions q JOIN question_result_snapshots r
         ON r.project_id=q.project_id AND r.sr_id=q.sr_id AND r.question_id=q.question_id
        AND r.version=q.current_result_version
      WHERE q.project_id=? AND q.sr_id=? AND q.question_id=?`,
  ).get(scope.projectId, scope.srId, questionId) as QuestionRow | undefined;
}

function readCurrentClassification(
  db: DatabaseConnection,
  scope: SrScope,
  ref: ScopeClassificationRef,
  expectedTarget: EntityRef<'question' | 'decision'>,
): CurrentScopeClassificationContent {
  const row = db.prepare(
    `SELECT target_kind,target_id,scope,required_gate,reason,classified_by,classified_at,
            previous_version,owner_id,revisit_at,revisit_event,payload_json
       FROM scope_classification_versions
      WHERE project_id=? AND sr_id=? AND classification_id=? AND version=?`,
  ).get(scope.projectId, scope.srId, ref.entityId, ref.version) as Record<string, unknown> | undefined;
  if (row === undefined) return corrupt('현재 classification row가 없습니다.');
  const targetKind = requiredString(row.target_kind, 'classification target kind');
  if (targetKind !== 'question' && targetKind !== 'decision') return corrupt('classification target kind가 올바르지 않습니다.');
  const targetRef = targetKind === 'question'
    ? questionEntityRef(scope, requiredString(row.target_id, 'classification target ID'))
    : decisionEntityRef(scope, requiredString(row.target_id, 'classification target ID'));
  if (targetRef.kind !== expectedTarget.kind || targetRef.entityId !== expectedTarget.entityId) {
    return corrupt('현재 classification 대상이 entity pointer와 다릅니다.');
  }
  const payload = objectJson(String(row.payload_json), 'classification payload');
  if (Object.hasOwn(payload, 'targetRef')) {
    const storedTarget = objectValue(payload.targetRef, 'classification payload target');
    if (storedTarget.kind !== targetRef.kind || storedTarget.projectId !== scope.projectId ||
      storedTarget.srId !== scope.srId || storedTarget.entityId !== targetRef.entityId) {
      return corrupt('classification payload target이 column과 다릅니다.');
    }
  }
  const common = {
    ref,
    targetRef,
    reason: requiredString(row.reason, 'classification reason'),
    classifiedBy: requiredString(row.classified_by, 'classification actor'),
    classifiedAt: requiredString(row.classified_at, 'classification time'),
    ...(row.previous_version === null ? {} : {
      previousVersionRef: classificationRef(
        scope, ref.entityId, positiveInteger(row.previous_version, 'previous classification version'),
      ),
    }),
    basisRefs: Object.hasOwn(payload, 'basisRefs')
      ? parseVersionRefs(db, scope, payload.basisRefs, 'classification basis refs') : [],
  };
  const classifiedScope = requiredString(row.scope, 'classification scope');
  const requiredGate = requiredString(row.required_gate, 'classification gate');
  if (classifiedScope === 'current' && (requiredGate === 'G1' || requiredGate === 'G2')) {
    return { ...common, scope: 'current', requiredGate };
  }
  if (classifiedScope !== 'followup' || requiredGate !== 'None') {
    return corrupt('classification scope와 gate 조합이 올바르지 않습니다.');
  }
  const ownerId = requiredString(row.owner_id, 'followup owner');
  const revisitAt = optionalString(row.revisit_at, 'followup revisitAt');
  const revisitEvent = optionalString(row.revisit_event, 'followup revisitEvent');
  if ((revisitAt === undefined) === (revisitEvent === undefined)) {
    return corrupt('followup 재검토 시점 또는 사건이 정확히 하나가 아닙니다.');
  }
  return {
    ...common,
    scope: 'followup',
    requiredGate: 'None',
    ownerId,
    revisit: revisitAt === undefined
      ? { kind: 'event', event: revisitEvent as string }
      : { kind: 'at', at: revisitAt },
  };
}

function parseQuestionView(db: DatabaseConnection, scope: SrScope, row: QuestionRow, explicitImpact?: ReviewImpact): StoredQuestionView {
  const questionId = requiredString(row.question_id, 'question ID');
  const resultVersion = positiveInteger(row.current_result_version, 'question result version');
  if (
    row.text !== row.result_text || row.reason !== row.result_reason ||
    row.assignee_id !== row.result_assignee_id || row.answer_mode !== row.result_answer_mode ||
    row.status !== row.result_status || row.classification_id !== row.result_classification_id ||
    row.classification_version !== row.result_classification_version
  ) return corrupt('현재 question과 result snapshot의 포인터 내용이 다릅니다.');
  const questionPayload = objectJson(row.payload_json, 'question payload');
  const resultPayload = objectJson(row.result_payload_json, 'question result payload');
  const parsedOptions = options(parseJson(row.options_json, 'question options'), 'question options');
  let selectedAnswer: QContentFields['currentResult']['selectedAnswer'];
  if ((row.selected_answer_id === null) !== (row.selected_answer_version === null)) {
    return corrupt('selected answer pointer가 불완전합니다.');
  }
  if (row.selected_answer_id !== null && row.selected_answer_version !== null) {
    const answerId = row.selected_answer_id;
    const answerVersion = positiveInteger(row.selected_answer_version, 'selected answer version');
    const answer = db.prepare(
      `SELECT answered_snapshot_version,answer_text,evidence_json,answered_by,answered_at,
              selected_option_id,payload_json
         FROM question_answer_versions
        WHERE project_id=? AND sr_id=? AND question_id=? AND answer_id=? AND version=?`,
    ).get(scope.projectId, scope.srId, questionId, answerId, answerVersion) as Record<string, unknown> | undefined;
    if (answer === undefined) return corrupt('selected answer의 실제 row가 없습니다.');
    const answerPayload = objectJson(String(answer.payload_json), 'answer payload');
    const selectedOptionId = optionalString(answer.selected_option_id, 'selected option ID');
    let answerContent: QAnswerContent;
    if (Object.hasOwn(answerPayload, 'answer')) {
      const storedAnswer = objectValue(answerPayload.answer, 'stored answer');
      const kind = requiredString(storedAnswer.kind, 'stored answer kind');
      const text = requiredString(storedAnswer.text, 'stored answer text');
      if (text !== answer.answer_text) return corrupt('stored answer text와 column이 다릅니다.');
      if (kind === 'choice') {
        const optionId = requiredString(storedAnswer.optionId, 'stored answer option ID');
        if (selectedOptionId !== optionId || !parsedOptions.some((item) => item.optionId === optionId)) {
          return corrupt('stored choice answer가 option 또는 column과 다릅니다.');
        }
        answerContent = { kind, optionId, text };
      } else if (kind === 'free_text') {
        if (selectedOptionId !== undefined) return corrupt('stored free-text answer에 option ID가 있습니다.');
        answerContent = { kind, text };
      } else {
        return corrupt('stored answer kind가 올바르지 않습니다.');
      }
    } else if (row.answer_mode === 'choice') {
      if (selectedOptionId === undefined || !parsedOptions.some((item) => item.optionId === selectedOptionId)) {
        return corrupt('choice answer의 option이 현재 질문과 맞지 않습니다.');
      }
      answerContent = { kind: 'choice', optionId: selectedOptionId, text: requiredString(answer.answer_text, 'answer text') };
    } else {
      if (selectedOptionId !== undefined) return corrupt('free text answer에 option ID가 있습니다.');
      answerContent = { kind: 'free_text', text: requiredString(answer.answer_text, 'answer text') };
    }
    selectedAnswer = {
      ref: questionAnswerRef(scope, answerId, answerVersion),
      answeredQuestionSnapshotRef: questionResultRef(scope, questionId, positiveInteger(answer.answered_snapshot_version, 'answered snapshot version')),
      answer: answerContent,
      evidence: parseEvidence(db, scope, String(answer.evidence_json), 'answer evidence'),
      answeredBy: requiredString(answer.answered_by, 'answer actor'),
      answeredAt: requiredString(answer.answered_at, 'answer time'),
    };
  }
  let resolution: QContentFields['currentResult']['resolution'];
  if (Object.hasOwn(resultPayload, 'resolution')) {
    const stored = objectValue(resultPayload.resolution, 'question resolution');
    const selectedAnswerRef = parseVersionRef(db, scope, stored.selectedAnswerRef, 'resolution selected answer ref');
    if (selectedAnswerRef.kind !== 'question_answer' || !('srId' in selectedAnswerRef)) {
      return corrupt('resolution selected answer ref kind가 올바르지 않습니다.');
    }
    const disposition = objectValue(stored.documentDisposition, 'resolution document disposition');
    let documentDisposition: NonNullable<typeof resolution>['documentDisposition'];
    if (disposition.kind === 'reflected') {
      const artifactVersionRefs = parseArtifactRefs(db, scope, disposition.artifactVersionRefs, 'resolution artifact refs');
      if (artifactVersionRefs.length === 0) return corrupt('resolution artifact refs가 비어 있습니다.');
      documentDisposition = { kind: 'reflected', artifactVersionRefs };
    } else if (disposition.kind === 'not_required') {
      documentDisposition = { kind: 'not_required', reason: requiredString(disposition.reason, 'resolution no-change reason') };
    } else {
      return corrupt('resolution document disposition이 올바르지 않습니다.');
    }
    resolution = {
      selectedAnswerRef: {
        kind: 'question_answer', projectId: selectedAnswerRef.projectId, srId: selectedAnswerRef.srId,
        entityId: selectedAnswerRef.entityId, version: selectedAnswerRef.version,
      },
      evidence: parseEvidence(db, scope, JSON.stringify(stored.evidence), 'resolution evidence'),
      documentDisposition,
      resolvedBy: requiredString(stored.resolvedBy, 'resolution actor'),
      resolvedAt: requiredString(stored.resolvedAt, 'resolution time'),
    };
  }
  if ((row.status === 'answered' || row.status === 'resolved') && selectedAnswer === undefined) {
    return corrupt('answered 또는 resolved question에 selected answer가 없습니다.');
  }
  if (row.status === 'resolved') {
    if (resolution === undefined || selectedAnswer === undefined ||
      resolution.selectedAnswerRef.entityId !== selectedAnswer.ref.entityId ||
      resolution.selectedAnswerRef.version !== selectedAnswer.ref.version) {
      return corrupt('resolved question의 해결 확인이 현재 답변과 다릅니다.');
    }
  } else if (resolution !== undefined) {
    return corrupt('resolved가 아닌 question에 해결 확인이 있습니다.');
  }
  const parentQuestionId = optionalString(row.parent_question_id, 'parent question ID');
  const convertedDecisionId = optionalString(row.converted_decision_id, 'converted decision ID');
  if ((row.status === 'converted_to_decision') !== (convertedDecisionId !== undefined)) {
    return corrupt('converted question의 decision 연결이 올바르지 않습니다.');
  }
  if (convertedDecisionId !== undefined && db.prepare(
    `SELECT 1 FROM decisions
      WHERE project_id=? AND sr_id=? AND decision_id=? AND origin_question_id=?`,
  ).get(scope.projectId, scope.srId, convertedDecisionId, questionId) === undefined) {
    return corrupt('converted question과 origin decision 연결이 서로 다릅니다.');
  }
  const dueAt = optionalString(questionPayload.dueAt, 'question dueAt');
  const sourceDraftValue = questionPayload.sourceDraft;
  const sourceDraft = sourceDraftValue === undefined ? undefined : (() => {
    const source = objectValue(sourceDraftValue, 'question sourceDraft');
    return {
      draftId: requiredString(source.draftId, 'question source draft ID'),
      temporaryId: requiredString(source.temporaryId, 'question temporary ID'),
    };
  })();
  return {
    scope,
    questionId,
    status: row.status,
    text: row.text,
    reason: row.reason,
    assigneeId: row.assignee_id,
    answerMode: row.answer_mode,
    options: parsedOptions,
    requiredGate: row.required_gate,
    classificationRef: classificationRef(scope, row.classification_id, positiveInteger(row.classification_version, 'classification version')),
    currentClassification: readCurrentClassification(db, scope, classificationRef(
      scope, row.classification_id, positiveInteger(row.classification_version, 'classification version'),
    ), questionEntityRef(scope, questionId)),
    ...(parentQuestionId === undefined ? {} : { parentQuestionId }),
    candidateAnswers: Object.hasOwn(resultPayload, 'candidateAnswers') ? stringArray(resultPayload.candidateAnswers, 'candidate answers') : [],
    relatedArtifactRefs: Object.hasOwn(questionPayload, 'relatedArtifactRefs')
      ? parseArtifactRefs(db, scope, questionPayload.relatedArtifactRefs, 'related artifact refs') : [],
    sourceRefs: Object.hasOwn(questionPayload, 'sourceRefs')
      ? parseVersionRefs(db, scope, questionPayload.sourceRefs, 'question source refs') : [],
    ...(dueAt === undefined ? {} : { dueAt }),
    ...(sourceDraft === undefined ? {} : { sourceDraft }),
    ...(convertedDecisionId === undefined ? {} : { convertedDecisionId }),
    createdAt: row.created_at,
    currentResult: {
      ref: questionResultRef(scope, questionId, resultVersion),
      capturedAt: row.captured_at,
      evidenceRefs: parseEvidenceRefs(db, scope, parseJson(row.evidence_refs_json, 'question evidence refs'), 'question evidence refs'),
      ...(selectedAnswer === undefined ? {} : { selectedAnswer }),
      ...(resolution === undefined ? {} : { resolution }),
    },
    revision: positiveInteger(row.revision, 'question revision'),
    allowedActions: [],
    reviewImpact: explicitImpact ?? noImpact(),
  };
}

export function readQuestionView(db: DatabaseConnection, scope: SrScope, questionId: string, explicitImpact?: ReviewImpact): StoredQuestionView | undefined {
  const row = questionRow(db, scope, questionId);
  return row === undefined ? undefined : parseQuestionView(db, scope, row, explicitImpact);
}

export function readQuestionViews(db: DatabaseConnection, projectId: string, srId: string): readonly QuestionView[] {
  const scope: SrScope = { kind: 'sr', projectId, srId };
  const ids = db.prepare('SELECT question_id FROM questions WHERE project_id=? AND sr_id=? ORDER BY question_id')
    .all(projectId, srId) as Array<{ readonly question_id: string }>;
  return ids.map(({ question_id: questionId }) => {
    const view = readQuestionView(db, scope, questionId);
    if (view === undefined) return corrupt('question reader가 현재 row를 잃었습니다.');
    return view;
  });
}

function decisionRow(db: DatabaseConnection, scope: SrScope, decisionId: string): DecisionRow | undefined {
  return db.prepare('SELECT * FROM decisions WHERE project_id=? AND sr_id=? AND decision_id=?')
    .get(scope.projectId, scope.srId, decisionId) as DecisionRow | undefined;
}

function decisionOrigin(
  db: DatabaseConnection,
  scope: SrScope,
  definition: DecisionRow,
): { readonly originQuestionId: string; readonly originQuestionResultSnapshotRef: QuestionResultSnapshotRef } | undefined {
  const originQuestionId = optionalString(definition.origin_question_id, 'origin question ID');
  const payload = objectJson(definition.payload_json, 'decision payload');
  const rawRef = payload.originQuestionResultSnapshotRef;
  if (originQuestionId === undefined && rawRef === undefined) return undefined;
  if (originQuestionId === undefined || rawRef === undefined) return corrupt('decision origin question 근거가 불완전합니다.');
  const parsed = parseVersionRef(db, scope, rawRef, 'origin question result ref');
  if (parsed.kind !== 'question_result' || !('srId' in parsed) || parsed.entityId !== originQuestionId) {
    return corrupt('decision origin question과 result snapshot 연결이 올바르지 않습니다.');
  }
  return {
    originQuestionId,
    originQuestionResultSnapshotRef: {
      kind: 'question_result', projectId: parsed.projectId, srId: parsed.srId,
      entityId: parsed.entityId, version: parsed.version,
    },
  };
}

function parseDecisionView(db: DatabaseConnection, scope: SrScope, row: DecisionRow, explicitImpact?: ReviewImpact): StoredDecisionView {
  const decisionId = requiredString(row.decision_id, 'decision ID');
  const definitionPayload = objectJson(row.payload_json, 'decision payload');
  const parsedAlternatives = alternatives(parseJson(row.alternatives_json, 'decision alternatives'), 'decision alternatives');
  let currentConfirmation: DecisionContentFields['currentConfirmation'];
  if (row.current_confirmed_version !== null) {
    const version = positiveInteger(row.current_confirmed_version, 'current decision version');
    const current = db.prepare(
      `SELECT prompt,alternatives_json,impact,selected_option,rationale,evidence_json,
              decision_maker_id,decided_at,classification_id,classification_version,
              previous_version,change_reason,payload_json
         FROM decision_versions
        WHERE project_id=? AND sr_id=? AND decision_id=? AND version=?`,
    ).get(scope.projectId, scope.srId, decisionId, version) as Record<string, unknown> | undefined;
    if (current === undefined) return corrupt('current decision version row가 없습니다.');
    if (current.prompt !== row.prompt || current.impact !== row.impact || current.decision_maker_id !== row.decision_maker_id) {
      return corrupt('decision 정의와 current version이 다릅니다.');
    }
    alternatives(parseJson(String(current.alternatives_json), 'decision version alternatives'), 'decision version alternatives');
    const versionPayload = objectJson(String(current.payload_json), 'decision version payload');
    const origin = decisionOrigin(db, scope, row);
    const versionOriginQuestionId = optionalString(versionPayload.originQuestionId, 'decision version origin question ID');
    const versionOriginRef = versionPayload.originQuestionResultSnapshotRef === undefined
      ? undefined
      : parseVersionRef(db, scope, versionPayload.originQuestionResultSnapshotRef, 'decision version origin result ref');
    if ((origin === undefined && (versionOriginQuestionId !== undefined || versionOriginRef !== undefined)) ||
      (origin !== undefined && (versionOriginQuestionId !== origin.originQuestionId ||
        versionOriginRef?.kind !== 'question_result' || !('srId' in versionOriginRef) ||
        versionOriginRef.entityId !== origin.originQuestionResultSnapshotRef.entityId ||
        versionOriginRef.version !== origin.originQuestionResultSnapshotRef.version))) {
      return corrupt('decision version의 origin question 근거가 정의와 다릅니다.');
    }
    let selection;
    if (Object.hasOwn(versionPayload, 'selection')) {
      const stored = objectValue(versionPayload.selection, 'decision selection');
      selection = {
        ...(stored.optionId === undefined ? {} : { optionId: requiredString(stored.optionId, 'decision selection optionId') }),
        text: requiredString(stored.text, 'decision selection text'),
      };
    } else {
      const selected = requiredString(current.selected_option, 'decision selected option');
      const alternative = parsedAlternatives.find((item) => item.optionId === selected);
      selection = alternative === undefined ? { text: selected } : { optionId: selected, text: alternative.label };
    }
    currentConfirmation = {
      ref: decisionVersionRef(scope, decisionId, version),
      selection,
      rationale: requiredString(current.rationale, 'decision rationale'),
      evidence: parseEvidence(db, scope, String(current.evidence_json), 'decision evidence'),
      decidedBy: requiredString(current.decision_maker_id, 'decision actor'),
      decidedAt: requiredString(current.decided_at, 'decision time'),
      classificationRef: classificationRef(
        scope,
        requiredString(current.classification_id, 'decision version classification ID'),
        positiveInteger(current.classification_version, 'decision version classification version'),
      ),
      ...(origin === undefined ? {} : origin),
      ...(current.previous_version === null
        ? {}
        : { previousVersionRef: decisionVersionRef(scope, decisionId, positiveInteger(current.previous_version, 'previous decision version')) }),
      ...(current.change_reason === null
        ? {}
        : { changeReason: requiredString(current.change_reason, 'decision change reason') }),
    };
  }
  const sourceDraftValue = definitionPayload.sourceDraft;
  const sourceDraft = sourceDraftValue === undefined ? undefined : (() => {
    const source = objectValue(sourceDraftValue, 'decision sourceDraft');
    return { draftId: requiredString(source.draftId, 'decision source draft ID'), temporaryId: requiredString(source.temporaryId, 'decision temporary ID') };
  })();
  const originQuestionId = optionalString(row.origin_question_id, 'origin question ID');
  const originQuestionResultSnapshotRef = Object.hasOwn(definitionPayload, 'originQuestionResultSnapshotRef')
    ? (() => {
        const ref = parseVersionRef(db, scope, definitionPayload.originQuestionResultSnapshotRef, 'origin question result ref');
        if (ref.kind !== 'question_result' || !('srId' in ref)) return corrupt('origin question result ref kind가 올바르지 않습니다.');
        return {
          kind: 'question_result' as const, projectId: ref.projectId, srId: ref.srId,
          entityId: ref.entityId, version: ref.version,
        };
      })()
    : undefined;
  if (originQuestionId !== undefined && (originQuestionResultSnapshotRef === undefined ||
    originQuestionResultSnapshotRef.entityId !== originQuestionId)) {
    return corrupt('origin question과 result snapshot 연결이 올바르지 않습니다.');
  }
  if (originQuestionId !== undefined && db.prepare(
    `SELECT 1 FROM questions
      WHERE project_id=? AND sr_id=? AND question_id=?
        AND status='converted_to_decision' AND converted_decision_id=?`,
  ).get(scope.projectId, scope.srId, originQuestionId, decisionId) === undefined) {
    return corrupt('origin decision과 converted question 연결이 서로 다릅니다.');
  }
  const recommendation = optionalString(definitionPayload.recommendation, 'decision recommendation');
  const definitionRequiredGate = requiredString(definitionPayload.requiredGate, 'decision definition required gate');
  if (definitionRequiredGate !== 'G1' && definitionRequiredGate !== 'G2' && definitionRequiredGate !== 'None') {
    return corrupt('decision required gate가 올바르지 않습니다.');
  }
  const currentClassificationRef = classificationRef(
    scope, row.classification_id, positiveInteger(row.classification_version, 'decision classification version'),
  );
  const currentClassification = readCurrentClassification(
    db, scope, currentClassificationRef, decisionEntityRef(scope, decisionId),
  );
  return {
    scope,
    decisionId,
    state: row.current_confirmed_version === null ? 'unconfirmed' : 'confirmed',
    prompt: row.prompt,
    alternatives: parsedAlternatives,
    impact: row.impact,
    decisionMakerId: row.decision_maker_id,
    requiredGate: currentClassification.requiredGate,
    classificationRef: currentClassificationRef,
    currentClassification,
    ...(recommendation === undefined ? {} : { recommendation }),
    sourceRefs: Object.hasOwn(definitionPayload, 'sourceRefs') ? parseVersionRefs(db, scope, definitionPayload.sourceRefs, 'decision source refs') : [],
    ...(originQuestionId === undefined ? {} : { originQuestionId }),
    ...(originQuestionResultSnapshotRef === undefined ? {} : { originQuestionResultSnapshotRef }),
    ...(sourceDraft === undefined ? {} : { sourceDraft }),
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...(currentConfirmation === undefined ? {} : { currentConfirmation }),
    revision: positiveInteger(row.revision, 'decision revision'),
    allowedActions: [],
    reviewImpact: explicitImpact ?? noImpact(),
  };
}

export function readDecisionView(db: DatabaseConnection, scope: SrScope, decisionId: string, explicitImpact?: ReviewImpact): StoredDecisionView | undefined {
  const row = decisionRow(db, scope, decisionId);
  return row === undefined ? undefined : parseDecisionView(db, scope, row, explicitImpact);
}

export function readDecisionViews(db: DatabaseConnection, projectId: string, srId: string): readonly DecisionView[] {
  const scope: SrScope = { kind: 'sr', projectId, srId };
  const ids = db.prepare('SELECT decision_id FROM decisions WHERE project_id=? AND sr_id=? ORDER BY decision_id')
    .all(projectId, srId) as Array<{ readonly decision_id: string }>;
  return ids.map(({ decision_id: decisionId }) => {
    const view = readDecisionView(db, scope, decisionId);
    if (view === undefined) return corrupt('decision reader가 현재 row를 잃었습니다.');
    return view;
  });
}

function ensureUniqueTemporaryIds(values: readonly { readonly temporaryId: string }[]): void {
  const ids = new Set<string>();
  for (const value of values) {
    inputString(value.temporaryId, 'temporaryId');
    if (ids.has(value.temporaryId)) invalid('temporaryId가 중복됩니다.');
    ids.add(value.temporaryId);
  }
}

function validateInputRefs(db: DatabaseConnection, scope: SrScope, refs: readonly VersionRef[], label: string): void {
  refs.forEach((ref, index) => {
    try {
      parseVersionRef(db, scope, ref, `${label}[${index}]`);
    } catch (error) {
      if (error instanceof QuestionDecisionRepositoryError) invalid(error.message);
      throw error;
    }
  });
}

function validateInputArtifactRefs(
  db: DatabaseConnection,
  scope: SrScope,
  refs: readonly ArtifactVersionRef[],
  label: string,
): void {
  refs.forEach((ref, index) => {
    try {
      const parsed = parseVersionRef(db, scope, ref, `${label}[${index}]`);
      if (parsed.kind !== 'artifact') invalid(`${label}[${index}] kind가 artifact가 아닙니다.`);
    } catch (error) {
      if (error instanceof QuestionDecisionRepositoryError && error.code === 'CORRUPT_DATA') {
        invalid(error.message);
      }
      throw error;
    }
  });
}

function validateInputAlternatives(values: readonly DecisionAlternativeContent[]): void {
  if (values.length === 0) invalid('decision alternative가 비어 있습니다.');
  const optionIds = new Set<string>();
  for (const value of values) {
    inputString(value.optionId, 'decision option ID');
    inputString(value.label, 'decision option label');
    inputString(value.description, 'decision option description');
    if (optionIds.has(value.optionId)) invalid('decision option ID가 중복됩니다.');
    optionIds.add(value.optionId);
  }
}

function validateInputEvidence(
  db: DatabaseConnection,
  scope: SrScope,
  evidence: QuestionAnswer['evidence'] | DecisionConfirmation['evidence'],
): void {
  if ('text' in evidence) {
    inputString(evidence.text, 'evidence text');
    return;
  }
  for (const [index, ref] of evidence.refs.entries()) {
    if (ref.kind === 'external') {
      inputString(ref.label, `evidence refs[${index}] label`);
      inputString(ref.verificationSummary, `evidence refs[${index}] verification summary`);
      continue;
    }
    validateInputRefs(db, scope, [ref], `evidence refs[${index}]`);
  }
}

function insertClassification(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly kind: 'question' | 'decision';
  readonly entityId: string;
  readonly classificationId: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly classification: QuestionClassificationInput;
}): ScopeClassificationRef {
  inputString(input.classification.reason, 'classification reason');
  let ownerId: string | null = null;
  let revisitAt: string | null = null;
  let revisitEvent: string | null = null;
  if (input.classification.scope === 'followup') {
    requireInputMember(db, input.scope.projectId, input.classification.ownerId, 'followup owner');
    ownerId = input.classification.ownerId;
    if (input.classification.revisit.kind === 'at') revisitAt = input.classification.revisit.at;
    else revisitEvent = inputString(input.classification.revisit.event, 'revisit event');
  }
  const target = input.kind === 'question'
    ? questionEntityRef(input.scope, input.entityId)
    : decisionEntityRef(input.scope, input.entityId);
  db.prepare(
    `INSERT INTO scope_classification_versions(
       project_id,sr_id,classification_id,version,target_kind,target_id,scope,required_gate,
       reason,classified_by,classified_at,previous_version,owner_id,revisit_at,revisit_event,payload_json
     ) VALUES (?,?,?,1,?,?,?,?,?,?,?,NULL,?,?,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.classificationId, input.kind, input.entityId,
    input.classification.scope, input.classification.requiredGate, input.classification.reason,
    input.actorId, input.occurredAt, ownerId, revisitAt, revisitEvent, JSON.stringify({ targetRef: target }));
  return classificationRef(input.scope, input.classificationId, 1);
}

function insertQuestionGraph(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly questionId: string;
  readonly text: string;
  readonly reason: string;
  readonly assigneeId: string;
  readonly answerMode: 'choice' | 'free_text';
  readonly options: readonly { readonly optionId: string; readonly text: string }[];
  readonly classification: QuestionClassificationInput;
  readonly candidateAnswers: readonly string[];
  readonly relatedArtifactRefs: readonly ArtifactVersionRef[];
  readonly sourceRefs: readonly VersionRef[];
  readonly parentQuestionId?: string;
  readonly dueAt?: string;
  readonly sourceDraft?: { readonly draftId: string; readonly temporaryId: string };
}): void {
  inputString(input.text, 'question text');
  inputString(input.reason, 'question reason');
  requireInputMember(db, input.scope.projectId, input.assigneeId, 'question assignee');
  if (input.answerMode === 'choice' && input.options.length === 0) invalid('choice question의 option이 비어 있습니다.');
  if (input.answerMode === 'free_text' && input.options.length !== 0) invalid('free text question은 option을 가질 수 없습니다.');
  const optionIds = new Set<string>();
  for (const option of input.options) {
    inputString(option.optionId, 'question option ID');
    inputString(option.text, 'question option text');
    if (optionIds.has(option.optionId)) invalid('question option ID가 중복됩니다.');
    optionIds.add(option.optionId);
  }
  input.candidateAnswers.forEach((value) => inputString(value, 'candidate answer'));
  validateInputRefs(db, input.scope, input.sourceRefs, 'question source ref');
  validateInputArtifactRefs(db, input.scope, input.relatedArtifactRefs, 'related artifact ref');
  const classificationId = `classification-${randomUUID()}`;
  const classification = insertClassification(db, {
    scope: input.scope, kind: 'question', entityId: input.questionId, classificationId,
    actorId: input.actorId, occurredAt: input.occurredAt, classification: input.classification,
  });
  const questionPayload = {
    relatedArtifactRefs: input.relatedArtifactRefs,
    sourceRefs: input.sourceRefs,
    ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
    ...(input.sourceDraft === undefined ? {} : { sourceDraft: input.sourceDraft }),
  };
  db.prepare(
    `INSERT INTO questions(
       project_id,sr_id,question_id,text,reason,assignee_id,answer_mode,required_gate,
       classification_id,classification_version,status,current_result_version,revision,created_at,
       parent_question_id,converted_decision_id,payload_json
     ) VALUES (?,?,?,?,?,?,?,?,?,1,'open',1,1,?,?,NULL,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.questionId, input.text, input.reason,
    input.assigneeId, input.answerMode, input.classification.requiredGate, classification.entityId,
    input.occurredAt, input.parentQuestionId ?? null, JSON.stringify(questionPayload));
  db.prepare(
    `INSERT INTO question_result_snapshots(
       project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
       status,classification_id,classification_version,evidence_refs_json,captured_at,
       selected_answer_id,selected_answer_version,payload_json
     ) VALUES (?,?,?,1,?,?,?,?,?,'open',?,1,?,?,NULL,NULL,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.questionId, input.text, input.reason,
    input.assigneeId, input.answerMode, JSON.stringify(input.options), classification.entityId,
    JSON.stringify(input.sourceRefs), input.occurredAt,
    JSON.stringify({ classificationRef: classification, candidateAnswers: input.candidateAnswers }));
}

export function applyQuestionDraftSelections(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: UserId;
  readonly occurredAt: string;
  readonly draftId: string;
  readonly proposals: readonly QuestionProposal[];
}): readonly DraftEntityMapping<'question'>[] {
  requireInputMember(db, input.scope.projectId, input.actorId, 'applying actor');
  inputString(input.draftId, 'draft ID');
  if (input.proposals.length === 0) invalid('question proposal 선택이 비어 있습니다.');
  ensureUniqueTemporaryIds(input.proposals);
  for (const proposal of input.proposals) {
    inputString(proposal.text, 'question proposal text');
    inputString(proposal.reason, 'question proposal reason');
    requireInputMember(db, input.scope.projectId, proposal.suggestedAssigneeId, 'suggested assignee');
    validateInputRefs(db, input.scope, proposal.sourceRefs, 'question proposal source ref');
  }
  return input.proposals.map((proposal) => {
    const questionId = `question-${randomUUID()}`;
    insertQuestionGraph(db, {
      scope: input.scope, actorId: input.actorId, occurredAt: input.occurredAt, questionId,
      text: proposal.text, reason: proposal.reason, assigneeId: proposal.suggestedAssigneeId,
      answerMode: 'free_text', options: [],
      classification: { scope: 'current', requiredGate: proposal.requiredGate, reason: proposal.reason },
      candidateAnswers: proposal.candidateAnswers, relatedArtifactRefs: [], sourceRefs: proposal.sourceRefs,
      sourceDraft: { draftId: input.draftId, temporaryId: proposal.temporaryId },
    });
    return { temporaryId: proposal.temporaryId, ref: questionEntityRef(input.scope, questionId) };
  });
}

export function applyDecisionDraftSelections(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: UserId;
  readonly occurredAt: string;
  readonly draftId: string;
  readonly selections: readonly DecisionDraftSelection[];
}): readonly DraftEntityMapping<'decision'>[] {
  requireInputMember(db, input.scope.projectId, input.actorId, 'applying actor');
  inputString(input.draftId, 'draft ID');
  if (input.selections.length === 0) invalid('decision proposal 선택이 비어 있습니다.');
  ensureUniqueTemporaryIds(input.selections.map(({ proposal }) => proposal));
  for (const selection of input.selections) {
    inputString(selection.proposal.prompt, 'decision prompt');
    inputString(selection.proposal.impact, 'decision impact');
    inputString(selection.proposal.recommendation, 'decision recommendation');
    validateInputAlternatives(selection.proposal.alternatives);
    requireInputMember(db, input.scope.projectId, selection.decisionMakerId, 'decision maker');
    validateInputRefs(db, input.scope, selection.proposal.sourceRefs, 'decision proposal source ref');
  }
  return input.selections.map((selection) => {
    const { proposal } = selection;
    const decisionId = `decision-${randomUUID()}`;
    const classificationId = `classification-${randomUUID()}`;
    const classification = insertClassification(db, {
      scope: input.scope, kind: 'decision', entityId: decisionId, classificationId,
      actorId: input.actorId, occurredAt: input.occurredAt, classification: selection.classification,
    });
    db.prepare(
      `INSERT INTO decisions(
         project_id,sr_id,decision_id,prompt,alternatives_json,impact,decision_maker_id,
         classification_id,classification_version,revision,created_by,created_at,
         current_confirmed_version,origin_question_id,payload_json
       ) VALUES (?,?,?,?,?,?,?,?,1,1,?,?,NULL,NULL,?)`,
    ).run(input.scope.projectId, input.scope.srId, decisionId, proposal.prompt,
      JSON.stringify(proposal.alternatives), proposal.impact, selection.decisionMakerId,
      classification.entityId, input.actorId, input.occurredAt, JSON.stringify({
        requiredGate: selection.classification.requiredGate,
        recommendation: proposal.recommendation,
        sourceRefs: proposal.sourceRefs,
        sourceDraft: { draftId: input.draftId, temporaryId: proposal.temporaryId },
      }));
    return { temporaryId: proposal.temporaryId, ref: decisionEntityRef(input.scope, decisionId) };
  });
}

export function insertFollowupQuestion(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly value: FollowupQuestion;
}): EntityRef<'question'> {
  const questionId = `question-${randomUUID()}`;
  insertQuestionGraph(db, {
    scope: input.scope, actorId: input.actorId, occurredAt: input.occurredAt, questionId,
    text: input.value.text, reason: input.value.reason, assigneeId: input.value.assigneeId,
    answerMode: input.value.answerMode, options: input.value.options ?? [],
    classification: input.value.classification, candidateAnswers: input.value.candidateAnswers ?? [],
    relatedArtifactRefs: input.value.relatedArtifactRefs ?? [], sourceRefs: input.value.sourceRefs ?? [],
    parentQuestionId: input.value.parentQuestionId,
    ...(input.value.dueAt === undefined ? {} : { dueAt: input.value.dueAt }),
  });
  return questionEntityRef(input.scope, questionId);
}

export function appendQuestionAnswer(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly value: QuestionAnswer;
  readonly currentResultVersion: number;
}): { readonly answerRef: QuestionAnswerVersionRef; readonly resultRef: QuestionResultSnapshotRef } {
  inputString(input.value.answer.text, 'answer text');
  validateInputEvidence(db, input.scope, input.value.evidence);
  const current = db.prepare(
    `SELECT selected_answer_id,selected_answer_version,payload_json
       FROM question_result_snapshots
      WHERE project_id=? AND sr_id=? AND question_id=? AND version=?`,
  ).get(input.scope.projectId, input.scope.srId, input.value.questionId, input.currentResultVersion) as
    { readonly selected_answer_id: string | null; readonly selected_answer_version: number | null; readonly payload_json: string } | undefined;
  if (current === undefined) invalid('question current result가 없습니다.');
  if ((current.selected_answer_id === null) !== (current.selected_answer_version === null)) {
    invalid('question selected answer pointer가 불완전합니다.');
  }
  const answerId = current.selected_answer_id ?? `answer-${randomUUID()}`;
  const previousVersion = current.selected_answer_version;
  const answerVersion = previousVersion === null ? 1 : previousVersion + 1;
  const answerRef = questionAnswerRef(input.scope, answerId, answerVersion);
  const nextResultVersion = input.currentResultVersion + 1;
  const currentPayload = objectJson(current.payload_json, 'question result payload');
  const { resolution: _resolution, convertedDecisionId: _converted, ...nextPayload } = currentPayload;
  db.prepare(
    `INSERT INTO question_answer_versions(
       project_id,sr_id,question_id,answer_id,version,answered_snapshot_version,answer_text,
       evidence_json,answered_by,answered_at,previous_version,selected_option_id,payload_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.value.questionId, answerId,
    answerVersion, input.currentResultVersion, input.value.answer.text, JSON.stringify(input.value.evidence),
    input.actorId, input.occurredAt, previousVersion,
    input.value.answer.kind === 'choice' ? input.value.answer.optionId : null,
    JSON.stringify({ answer: input.value.answer }));
  db.prepare(
    `INSERT INTO question_result_snapshots(
       project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
       status,classification_id,classification_version,evidence_refs_json,captured_at,
       selected_answer_id,selected_answer_version,payload_json
     ) SELECT project_id,sr_id,question_id,?,text,reason,assignee_id,answer_mode,options_json,
              'answered',classification_id,classification_version,evidence_refs_json,?, ?,?,?
         FROM question_result_snapshots
        WHERE project_id=? AND sr_id=? AND question_id=? AND version=?`,
  ).run(nextResultVersion, input.occurredAt, answerId, answerVersion, JSON.stringify(nextPayload),
    input.scope.projectId, input.scope.srId,
    input.value.questionId, input.currentResultVersion);
  const updated = db.prepare(
    `UPDATE questions SET status='answered',current_result_version=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND question_id=? AND current_result_version=?`,
  ).run(nextResultVersion, input.scope.projectId, input.scope.srId, input.value.questionId, input.currentResultVersion);
  if (updated.changes !== 1) invalid('question current result가 바뀌었습니다.');
  return { answerRef, resultRef: questionResultRef(input.scope, input.value.questionId, nextResultVersion) };
}

export function appendQuestionResolution(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly value: QuestionResolution;
  readonly currentResultVersion: number;
}): QuestionResultSnapshotRef {
  validateInputEvidence(db, input.scope, input.value.resolutionEvidence);
  if (input.value.documentDisposition.kind === 'reflected') {
    if (input.value.documentDisposition.artifactVersionRefs.length === 0) invalid('반영 문서 ref가 비어 있습니다.');
    validateInputArtifactRefs(db, input.scope, input.value.documentDisposition.artifactVersionRefs, 'resolution artifact ref');
  } else {
    inputString(input.value.documentDisposition.reason, '문서 변경 불필요 이유');
  }
  const current = db.prepare(
    `SELECT selected_answer_id,selected_answer_version,payload_json
       FROM question_result_snapshots
      WHERE project_id=? AND sr_id=? AND question_id=? AND version=?`,
  ).get(input.scope.projectId, input.scope.srId, input.value.questionId, input.currentResultVersion) as
    { readonly selected_answer_id: string | null; readonly selected_answer_version: number | null; readonly payload_json: string } | undefined;
  if (current === undefined || current.selected_answer_id === null || current.selected_answer_version === null) {
    invalid('해결할 현재 답변이 없습니다.');
  }
  if (current.selected_answer_id !== input.value.selectedAnswerRef.entityId ||
    current.selected_answer_version !== input.value.selectedAnswerRef.version) {
    invalid('해결 대상 답변이 현재 선택 답변과 다릅니다.');
  }
  const nextResultVersion = input.currentResultVersion + 1;
  const { resolution: _resolution, ...currentResultPayload } = objectJson(
    current.payload_json,
    'question result payload',
  );
  const payload = {
    ...currentResultPayload,
    resolution: {
      selectedAnswerRef: input.value.selectedAnswerRef,
      evidence: input.value.resolutionEvidence,
      documentDisposition: input.value.documentDisposition,
      resolvedBy: input.actorId,
      resolvedAt: input.occurredAt,
    },
  };
  db.prepare(
    `INSERT INTO question_result_snapshots(
       project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
       status,classification_id,classification_version,evidence_refs_json,captured_at,
       selected_answer_id,selected_answer_version,payload_json
     ) SELECT project_id,sr_id,question_id,?,text,reason,assignee_id,answer_mode,options_json,
              'resolved',classification_id,classification_version,evidence_refs_json,?,
              selected_answer_id,selected_answer_version,?
         FROM question_result_snapshots
        WHERE project_id=? AND sr_id=? AND question_id=? AND version=?`,
  ).run(nextResultVersion, input.occurredAt, JSON.stringify(payload), input.scope.projectId,
    input.scope.srId, input.value.questionId, input.currentResultVersion);
  const updated = db.prepare(
    `UPDATE questions SET status='resolved',current_result_version=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND question_id=? AND current_result_version=? AND status='answered'`,
  ).run(nextResultVersion, input.scope.projectId, input.scope.srId, input.value.questionId, input.currentResultVersion);
  if (updated.changes !== 1) invalid('question current result가 바뀌었습니다.');
  return questionResultRef(input.scope, input.value.questionId, nextResultVersion);
}

export function convertQuestionToDecision(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly value: DecisionConversion;
  readonly currentResultVersion: number;
  readonly requiredGate: 'G1' | 'G2' | 'None';
}): {
  readonly decisionRef: EntityRef<'decision'>;
  readonly resultRef: QuestionResultSnapshotRef;
  readonly classificationRef: ScopeClassificationRef;
} {
  inputString(input.value.prompt, 'decision prompt');
  inputString(input.value.impact, 'decision impact');
  validateInputAlternatives(input.value.alternatives);
  requireInputMember(db, input.scope.projectId, input.value.decisionMakerId, 'decision maker');
  const parsedClassification = parseVersionRef(db, input.scope, input.value.classificationRef, 'decision classification ref');
  if (parsedClassification.kind !== 'scope_classification') invalid('decision classification ref kind가 올바르지 않습니다.');
  const current = db.prepare(
    `SELECT payload_json FROM question_result_snapshots
      WHERE project_id=? AND sr_id=? AND question_id=? AND version=?`,
  ).get(input.scope.projectId, input.scope.srId, input.value.questionId, input.currentResultVersion) as
    { readonly payload_json: string } | undefined;
  if (current === undefined) invalid('question current result가 없습니다.');
  const decisionId = `decision-${randomUUID()}`;
  const decisionRef = decisionEntityRef(input.scope, decisionId);
  const sourceClassification = db.prepare(
    `SELECT scope,required_gate,reason,owner_id,revisit_at,revisit_event,payload_json
       FROM scope_classification_versions
      WHERE project_id=? AND sr_id=? AND classification_id=? AND version=?`,
  ).get(input.scope.projectId, input.scope.srId, input.value.classificationRef.entityId,
    input.value.classificationRef.version) as Record<string, unknown> | undefined;
  if (sourceClassification === undefined) invalid('question classification row가 없습니다.');
  objectJson(String(sourceClassification.payload_json), 'source classification payload');
  const decisionClassificationId = `classification-${randomUUID()}`;
  const decisionClassificationRef = classificationRef(input.scope, decisionClassificationId, 1);
  db.prepare(
    `INSERT INTO scope_classification_versions(
       project_id,sr_id,classification_id,version,target_kind,target_id,scope,required_gate,
       reason,classified_by,classified_at,previous_version,owner_id,revisit_at,revisit_event,payload_json
     ) VALUES (?,?,?,1,'decision',?,?,?,?,?,?,NULL,?,?,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, decisionClassificationId, decisionId,
    sourceClassification.scope, sourceClassification.required_gate, sourceClassification.reason,
    input.actorId, input.occurredAt, sourceClassification.owner_id, sourceClassification.revisit_at,
    sourceClassification.revisit_event, JSON.stringify({
      targetRef: decisionRef,
      sourceClassificationRef: input.value.classificationRef,
      basisRefs: [input.value.classificationRef],
    }));
  db.prepare(
    `INSERT INTO decisions(
       project_id,sr_id,decision_id,prompt,alternatives_json,impact,decision_maker_id,
       classification_id,classification_version,revision,created_by,created_at,
       current_confirmed_version,origin_question_id,payload_json
     ) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,NULL,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, decisionId, input.value.prompt,
    JSON.stringify(input.value.alternatives), input.value.impact, input.value.decisionMakerId,
    decisionClassificationRef.entityId, decisionClassificationRef.version,
    input.actorId, input.occurredAt, input.value.questionId, JSON.stringify({
      requiredGate: input.requiredGate,
      sourceRefs: [],
      originQuestionResultSnapshotRef: input.value.questionResultSnapshotRef,
    }));
  const nextResultVersion = input.currentResultVersion + 1;
  const { resolution: _resolution, ...currentResultPayload } = objectJson(
    current.payload_json,
    'question result payload',
  );
  const payload = {
    ...currentResultPayload,
    convertedDecisionId: decisionId,
  };
  db.prepare(
    `INSERT INTO question_result_snapshots(
       project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
       status,classification_id,classification_version,evidence_refs_json,captured_at,
       selected_answer_id,selected_answer_version,payload_json
     ) SELECT project_id,sr_id,question_id,?,text,reason,assignee_id,answer_mode,options_json,
              'converted_to_decision',classification_id,classification_version,evidence_refs_json,?,
              selected_answer_id,selected_answer_version,?
         FROM question_result_snapshots
        WHERE project_id=? AND sr_id=? AND question_id=? AND version=?`,
  ).run(nextResultVersion, input.occurredAt, JSON.stringify(payload), input.scope.projectId,
    input.scope.srId, input.value.questionId, input.currentResultVersion);
  const updated = db.prepare(
    `UPDATE questions
        SET status='converted_to_decision',converted_decision_id=?,current_result_version=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND question_id=? AND current_result_version=?
        AND status<>'converted_to_decision'`,
  ).run(decisionId, nextResultVersion, input.scope.projectId, input.scope.srId,
    input.value.questionId, input.currentResultVersion);
  if (updated.changes !== 1) invalid('question이 이미 전환됐거나 current result가 바뀌었습니다.');
  return {
    decisionRef,
    resultRef: questionResultRef(input.scope, input.value.questionId, nextResultVersion),
    classificationRef: decisionClassificationRef,
  };
}

export function appendDecisionConfirmation(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly value: DecisionConfirmation;
}): DecisionVersionRef {
  inputString(input.value.selection.text, 'decision selection');
  inputString(input.value.rationale, 'decision rationale');
  validateInputEvidence(db, input.scope, input.value.evidence);
  const definition = decisionRow(db, input.scope, input.value.decisionId);
  if (definition === undefined) invalid('decision이 없습니다.');
  const origin = decisionOrigin(db, input.scope, definition);
  const parsedAlternatives = alternatives(parseJson(definition.alternatives_json, 'decision alternatives'), 'decision alternatives');
  if (input.value.selection.optionId !== undefined &&
    !parsedAlternatives.some((item) => item.optionId === input.value.selection.optionId)) {
    invalid('decision selection option이 대안에 없습니다.');
  }
  db.prepare(
    `INSERT INTO decision_versions(
       project_id,sr_id,decision_id,version,prompt,alternatives_json,impact,selected_option,
       rationale,evidence_json,decision_maker_id,decided_at,classification_id,
       classification_version,previous_version,change_reason,payload_json
     ) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.value.decisionId, definition.prompt,
    definition.alternatives_json, definition.impact,
    input.value.selection.optionId ?? input.value.selection.text, input.value.rationale,
    JSON.stringify(input.value.evidence), input.actorId, input.occurredAt,
    definition.classification_id, definition.classification_version,
    JSON.stringify({ selection: input.value.selection, ...(origin === undefined ? {} : origin) }));
  const updated = db.prepare(
    `UPDATE decisions SET current_confirmed_version=1,revision=revision+1
      WHERE project_id=? AND sr_id=? AND decision_id=? AND current_confirmed_version IS NULL`,
  ).run(input.scope.projectId, input.scope.srId, input.value.decisionId);
  if (updated.changes !== 1) invalid('decision이 이미 확정됐습니다.');
  return decisionVersionRef(input.scope, input.value.decisionId, 1);
}

export function appendDecisionRevision(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly value: DecisionRevision;
  readonly currentVersion: number;
}): DecisionVersionRef {
  inputString(input.value.selection.text, 'decision selection');
  inputString(input.value.rationale, 'decision rationale');
  inputString(input.value.changeReason, 'decision change reason');
  validateInputEvidence(db, input.scope, input.value.evidence);
  const definition = decisionRow(db, input.scope, input.value.decisionId);
  if (definition === undefined) invalid('decision이 없습니다.');
  const origin = decisionOrigin(db, input.scope, definition);
  const parsedAlternatives = alternatives(parseJson(definition.alternatives_json, 'decision alternatives'), 'decision alternatives');
  if (input.value.selection.optionId !== undefined &&
    !parsedAlternatives.some((item) => item.optionId === input.value.selection.optionId && item.label === input.value.selection.text)) {
    invalid('decision selection option이 현재 대안과 다릅니다.');
  }
  const nextVersion = input.currentVersion + 1;
  db.prepare(
    `INSERT INTO decision_versions(
       project_id,sr_id,decision_id,version,prompt,alternatives_json,impact,selected_option,
       rationale,evidence_json,decision_maker_id,decided_at,classification_id,
       classification_version,previous_version,change_reason,payload_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.value.decisionId, nextVersion,
    definition.prompt, definition.alternatives_json, definition.impact,
    input.value.selection.optionId ?? input.value.selection.text, input.value.rationale,
    JSON.stringify(input.value.evidence), input.actorId, input.occurredAt,
    definition.classification_id, definition.classification_version,
    input.currentVersion, input.value.changeReason,
    JSON.stringify({ selection: input.value.selection, ...(origin === undefined ? {} : origin) }));
  const updated = db.prepare(
    `UPDATE decisions SET current_confirmed_version=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND decision_id=? AND current_confirmed_version=?`,
  ).run(nextVersion, input.scope.projectId, input.scope.srId, input.value.decisionId, input.currentVersion);
  if (updated.changes !== 1) invalid('decision current version이 바뀌었습니다.');
  return decisionVersionRef(input.scope, input.value.decisionId, nextVersion);
}

export interface StoredScopeState {
  readonly classificationRef: ScopeClassificationRef;
  readonly scope: 'current' | 'followup';
  readonly requiredGate: 'G1' | 'G2' | 'None';
}

export function readScopeState(
  db: DatabaseConnection,
  scope: SrScope,
  target: EntityRef<'question' | 'decision'>,
): StoredScopeState | undefined {
  const row = db.prepare(
    `SELECT c.classification_id,c.version,c.scope,c.required_gate,c.target_kind,c.target_id
       FROM scope_classification_versions c
       JOIN ${target.kind === 'question' ? 'questions' : 'decisions'} t
         ON t.project_id=c.project_id AND t.sr_id=c.sr_id
        AND t.classification_id=c.classification_id AND t.classification_version=c.version
      WHERE t.project_id=? AND t.sr_id=? AND t.${target.kind === 'question' ? 'question_id' : 'decision_id'}=?`,
  ).get(scope.projectId, scope.srId, target.entityId) as Record<string, unknown> | undefined;
  if (row === undefined) return undefined;
  const classifiedScope = requiredString(row.scope, 'classification scope');
  const requiredGate = requiredString(row.required_gate, 'classification required gate');
  if ((classifiedScope !== 'current' && classifiedScope !== 'followup') ||
    (requiredGate !== 'G1' && requiredGate !== 'G2' && requiredGate !== 'None')) {
    return corrupt('classification scope 또는 gate가 올바르지 않습니다.');
  }
  return {
    classificationRef: classificationRef(
      scope,
      requiredString(row.classification_id, 'classification ID'),
      positiveInteger(row.version, 'classification version'),
    ),
    scope: classifiedScope,
    requiredGate,
  };
}

function currentRequirementsBasis(db: DatabaseConnection, scope: SrScope, ref: VersionRef): boolean {
  if (ref.kind !== 'artifact' || !('srId' in ref)) return false;
  const row = db.prepare(
    `SELECT v.previous_version,v.requirement_links_json
       FROM artifacts a JOIN artifact_versions v
         ON v.project_id=a.project_id AND v.sr_id=a.sr_id AND v.artifact_id=a.artifact_id
        AND v.kind=a.kind AND v.version=a.current_version
      WHERE a.project_id=? AND a.sr_id=? AND a.artifact_id=? AND a.kind='requirements'
        AND a.current_version=?`,
  ).get(scope.projectId, scope.srId, ref.entityId, ref.version) as
    { readonly previous_version: number | null; readonly requirement_links_json: string } | undefined;
  if (row === undefined || row.previous_version === null) return false;
  const links = arrayValue(parseJson(row.requirement_links_json, 'requirements links'), 'requirements links');
  return links.length > 0 && links.every((value, index) => {
    const link = objectValue(value, `requirements links[${index}]`);
    return arrayValue(link.acceptanceCriteria, `requirements links[${index}].acceptanceCriteria`)
      .some((criterion, criterionIndex) =>
        requiredString(criterion, `requirements links[${index}].acceptanceCriteria[${criterionIndex}]`).trim().length > 0);
  });
}

function currentConfirmedDecisionBasis(db: DatabaseConnection, scope: SrScope, ref: VersionRef): boolean {
  return ref.kind === 'decision' && 'srId' in ref && db.prepare(
    `SELECT 1 FROM decisions
      WHERE project_id=? AND sr_id=? AND decision_id=? AND current_confirmed_version=?`,
  ).get(scope.projectId, scope.srId, ref.entityId, ref.version) !== undefined;
}

export function validateScopeReductionBasis(
  db: DatabaseConnection,
  scope: SrScope,
  refs: readonly VersionRef[] | undefined,
): void {
  if (refs === undefined || refs.length === 0) invalid('범위 축소 근거 ref가 비어 있습니다.');
  validateInputRefs(db, scope, refs, 'scope reduction basis ref');
  if (!refs.some((ref) => currentConfirmedDecisionBasis(db, scope, ref))) {
    invalid('현재 확정된 범위 축소 decision version ref가 필요합니다.');
  }
  if (!refs.some((ref) => currentRequirementsBasis(db, scope, ref))) {
    invalid('현재 개정 requirements와 완료 기준 artifact version ref가 필요합니다.');
  }
}

export function appendScopeClassification(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly value: ScopeClassification;
  readonly before: StoredScopeState;
}): {
  readonly classificationRef: ScopeClassificationRef;
  readonly questionResultRef?: QuestionResultSnapshotRef;
  readonly revision: number;
} {
  inputString(input.value.reason, 'classification reason');
  validateInputRefs(db, input.scope, input.value.basisRefs ?? [], 'classification basis ref');
  let ownerId: string | null = null;
  let revisitAt: string | null = null;
  let revisitEvent: string | null = null;
  if (input.value.scope === 'followup') {
    requireInputMember(db, input.scope.projectId, input.value.ownerId, 'followup owner');
    ownerId = input.value.ownerId;
    if (input.value.revisit.kind === 'at') revisitAt = inputString(input.value.revisit.at, 'revisit time');
    else revisitEvent = inputString(input.value.revisit.event, 'revisit event');
  }
  const nextVersion = input.before.classificationRef.version + 1;
  db.prepare(
    `INSERT INTO scope_classification_versions(
       project_id,sr_id,classification_id,version,target_kind,target_id,scope,required_gate,
       reason,classified_by,classified_at,previous_version,owner_id,revisit_at,revisit_event,payload_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(input.scope.projectId, input.scope.srId, input.before.classificationRef.entityId,
    nextVersion, input.value.targetRef.kind, input.value.targetRef.entityId,
    input.value.scope, input.value.requiredGate, input.value.reason, input.actorId, input.occurredAt,
    input.before.classificationRef.version, ownerId, revisitAt, revisitEvent,
    JSON.stringify({ targetRef: input.value.targetRef, basisRefs: input.value.basisRefs ?? [] }));
  const nextRef = classificationRef(input.scope, input.before.classificationRef.entityId, nextVersion);
  if (input.value.targetRef.kind === 'question') {
    const current = db.prepare(
      'SELECT current_result_version,revision FROM questions WHERE project_id=? AND sr_id=? AND question_id=?',
    ).get(input.scope.projectId, input.scope.srId, input.value.targetRef.entityId) as
      { readonly current_result_version: number; readonly revision: number } | undefined;
    if (current === undefined) invalid('분류할 question이 없습니다.');
    const nextResultVersion = current.current_result_version + 1;
    db.prepare(
      `INSERT INTO question_result_snapshots(
         project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
         status,classification_id,classification_version,evidence_refs_json,captured_at,
         selected_answer_id,selected_answer_version,payload_json
       ) SELECT project_id,sr_id,question_id,?,text,reason,assignee_id,answer_mode,options_json,
                status,?,?,evidence_refs_json,?,selected_answer_id,selected_answer_version,payload_json
           FROM question_result_snapshots
          WHERE project_id=? AND sr_id=? AND question_id=? AND version=?`,
    ).run(nextResultVersion, nextRef.entityId, nextRef.version, input.occurredAt,
      input.scope.projectId, input.scope.srId, input.value.targetRef.entityId, current.current_result_version);
    const updated = db.prepare(
      `UPDATE questions SET required_gate=?,classification_id=?,classification_version=?,
         current_result_version=?,revision=revision+1
       WHERE project_id=? AND sr_id=? AND question_id=? AND revision=?`,
    ).run(input.value.requiredGate, nextRef.entityId, nextRef.version, nextResultVersion,
      input.scope.projectId, input.scope.srId, input.value.targetRef.entityId, current.revision);
    if (updated.changes !== 1) invalid('question 분류 대상이 바뀌었습니다.');
    return {
      classificationRef: nextRef,
      questionResultRef: questionResultRef(input.scope, input.value.targetRef.entityId, nextResultVersion),
      revision: current.revision + 1,
    };
  }
  const current = db.prepare(
    'SELECT revision FROM decisions WHERE project_id=? AND sr_id=? AND decision_id=?',
  ).get(input.scope.projectId, input.scope.srId, input.value.targetRef.entityId) as
    { readonly revision: number } | undefined;
  if (current === undefined) invalid('분류할 decision이 없습니다.');
  const updated = db.prepare(
    `UPDATE decisions SET classification_id=?,classification_version=?,revision=revision+1
      WHERE project_id=? AND sr_id=? AND decision_id=? AND revision=?`,
  ).run(nextRef.entityId, nextRef.version, input.scope.projectId, input.scope.srId,
    input.value.targetRef.entityId, current.revision);
  if (updated.changes !== 1) invalid('decision 분류 대상이 바뀌었습니다.');
  return { classificationRef: nextRef, revision: current.revision + 1 };
}

export function readScopeView(
  db: DatabaseConnection,
  scope: SrScope,
  target: EntityRef<'question' | 'decision'>,
  reviewImpact: ReviewImpact = noImpact(),
): ScopeView | undefined {
  const state = readScopeState(db, scope, target);
  if (state === undefined) return undefined;
  const row = db.prepare(
    `SELECT revision FROM ${target.kind === 'question' ? 'questions' : 'decisions'}
      WHERE project_id=? AND sr_id=? AND ${target.kind === 'question' ? 'question_id' : 'decision_id'}=?`,
  ).get(scope.projectId, scope.srId, target.entityId) as { readonly revision: number } | undefined;
  if (row === undefined) return undefined;
  return {
    targetRef: target,
    classificationRef: state.classificationRef,
    classification: readCurrentClassification(db, scope, state.classificationRef, target),
    scope: state.scope,
    requiredGate: state.requiredGate,
    revision: positiveInteger(row.revision, 'scope target revision'),
    reviewImpact,
  };
}

export function insertQuestionDecisionActivity(db: DatabaseConnection, input: {
  readonly scope: SrScope;
  readonly actorId: string;
  readonly receiptId: string;
  readonly occurredAt: string;
  readonly eventType:
    | 'question_answered'
    | 'question_resolved'
    | 'followup_question_added'
    | 'question_converted'
    | 'decision_confirmed'
    | 'decision_revised'
    | 'scope_classified';
  readonly description: string;
  readonly targetRefs: readonly (EntityRef | VersionRef)[];
}): void {
  db.prepare(
    `INSERT INTO activity_events(
       project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,
       occurred_at,receipt_id,internal_basis_json,description,payload_json
     ) VALUES (?,? ,?,?,'user',?,?,?, ?,NULL,?,'{}')`,
  ).run(input.scope.projectId, `activity-${randomUUID()}`, input.scope.srId, input.eventType,
    input.actorId, JSON.stringify(input.targetRefs), input.occurredAt, input.receiptId, input.description);
}
