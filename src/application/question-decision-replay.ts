import type {
  ArtifactVersionRef,
  EntityRef,
  EvidenceRef,
  SrScope,
  SrVersionKind,
  SrVersionRef,
  VersionRef,
} from '@/src/contracts/context';
import type {
  CurrentScopeClassificationContent,
  DecisionContentFields,
  QContentFields,
  QStoredEvidence,
} from '@/src/contracts/question-decision-content';
import type { ReviewImpact } from '@/src/contracts/results';
import type { DecisionView, QuestionView, ScopeView } from '@/src/contracts/views';

export class QuestionDecisionReplayError extends Error {}

type JsonObject = Readonly<Record<string, unknown>>;

const SR_VERSION_KINDS = new Set([
  'sr_description', 'context_source', 'artifact', 'question_answer', 'question_result',
  'decision', 'scope_classification', 'review_assignment', 'handoff',
]);

function corrupt(message: string): never {
  throw new QuestionDecisionReplayError(message);
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return corrupt(`${label}가 객체가 아닙니다.`);
  }
  return value as JsonObject;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) return corrupt(`${label}이 올바르지 않습니다.`);
  return value;
}

function integerValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return corrupt(`${label}이 양의 정수가 아닙니다.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) return corrupt(`${label}가 배열이 아닙니다.`);
  return value.map((item, index) => stringValue(item, `${label}[${index}]`));
}

function scopeValue(value: unknown, expected: SrScope): SrScope {
  const scope = objectValue(value, 'replay scope');
  if (scope.kind !== 'sr' || scope.projectId !== expected.projectId || scope.srId !== expected.srId) {
    return corrupt('replay scope가 요청 범위와 다릅니다.');
  }
  return { kind: 'sr', projectId: expected.projectId, srId: expected.srId };
}

function entityRefValue<K extends 'question' | 'decision'>(
  value: unknown,
  scope: SrScope,
  allowedKinds: readonly K[],
  label: string,
): EntityRef<K> {
  const ref = objectValue(value, label);
  if (!allowedKinds.includes(ref.kind as K) || ref.projectId !== scope.projectId || ref.srId !== scope.srId) {
    return corrupt(`${label}의 kind 또는 scope가 올바르지 않습니다.`);
  }
  return {
    kind: ref.kind as K,
    projectId: scope.projectId,
    srId: scope.srId,
    entityId: stringValue(ref.entityId, `${label} entityId`),
  } as EntityRef<K>;
}

function versionRefValue(value: unknown, scope: SrScope, label: string): VersionRef {
  const ref = objectValue(value, label);
  const kind = stringValue(ref.kind, `${label} kind`);
  const projectId = stringValue(ref.projectId, `${label} projectId`);
  const entityId = stringValue(ref.entityId, `${label} entityId`);
  const version = integerValue(ref.version, `${label} version`);
  if (projectId !== scope.projectId) return corrupt(`${label} projectId가 요청 범위와 다릅니다.`);
  if (kind === 'review_policy') {
    if (ref.srId !== undefined) return corrupt(`${label} review policy에 srId가 있습니다.`);
    return { kind, projectId, entityId, version };
  }
  if (!SR_VERSION_KINDS.has(kind) || ref.srId !== scope.srId) {
    return corrupt(`${label} kind 또는 SR이 올바르지 않습니다.`);
  }
  return { kind, projectId, srId: scope.srId, entityId, version } as VersionRef;
}

function versionRefOf<K extends SrVersionKind>(
  value: unknown,
  scope: SrScope,
  kind: K,
  label: string,
): SrVersionRef<K> {
  const ref = versionRefValue(value, scope, label);
  if (ref.kind !== kind) return corrupt(`${label} kind가 ${kind}가 아닙니다.`);
  return ref as SrVersionRef<K>;
}

function versionRefs(value: unknown, scope: SrScope, label: string): readonly VersionRef[] {
  if (!Array.isArray(value)) return corrupt(`${label}가 배열이 아닙니다.`);
  return value.map((item, index) => versionRefValue(item, scope, `${label}[${index}]`));
}

function evidenceRef(value: unknown, scope: SrScope, label: string): EvidenceRef {
  const ref = objectValue(value, label);
  if (ref.kind !== 'external') return versionRefValue(ref, scope, label);
  return {
    kind: 'external',
    label: stringValue(ref.label, `${label} label`),
    ...(ref.url === undefined ? {} : { url: stringValue(ref.url, `${label} url`) }),
    verificationSummary: stringValue(ref.verificationSummary, `${label} verificationSummary`),
  };
}

function evidenceRefs(value: unknown, scope: SrScope, label: string): readonly EvidenceRef[] {
  if (!Array.isArray(value)) return corrupt(`${label}가 배열이 아닙니다.`);
  return value.map((item, index) => evidenceRef(item, scope, `${label}[${index}]`));
}

function evidence(value: unknown, scope: SrScope, label: string): QStoredEvidence {
  const stored = objectValue(value, label);
  const hasText = Object.hasOwn(stored, 'text');
  const hasRefs = Object.hasOwn(stored, 'refs');
  if (hasText === hasRefs) return corrupt(`${label}는 text 또는 refs 중 하나여야 합니다.`);
  return hasText
    ? { text: stringValue(stored.text, `${label} text`) }
    : { refs: evidenceRefs(stored.refs, scope, `${label} refs`) };
}

function reviewImpact(value: unknown): ReviewImpact {
  const impact = objectValue(value, 'replay reviewImpact');
  if (!Array.isArray(impact.affectedGates) ||
    !impact.affectedGates.every((gate) => gate === 'G1' || gate === 'G2') ||
    typeof impact.needsNewReview !== 'boolean' || typeof impact.currentHandoffValid !== 'boolean') {
    return corrupt('replay reviewImpact가 올바르지 않습니다.');
  }
  return {
    affectedGates: [...impact.affectedGates] as readonly ('G1' | 'G2')[],
    needsNewReview: impact.needsNewReview,
    ...(impact.returnStage === undefined
      ? {}
      : { returnStage: stringValue(impact.returnStage, 'replay reviewImpact returnStage') }),
    carriedBlockingRequestIds: stringArray(
      impact.carriedBlockingRequestIds,
      'replay reviewImpact carriedBlockingRequestIds',
    ),
    currentHandoffValid: impact.currentHandoffValid,
  };
}

function sameRef(left: VersionRef, right: VersionRef): boolean {
  return left.kind === right.kind && left.projectId === right.projectId &&
    ('srId' in left ? left.srId : undefined) === ('srId' in right ? right.srId : undefined) &&
    left.entityId === right.entityId && left.version === right.version;
}

function currentClassification(
  value: unknown,
  scope: SrScope,
  expectedTarget: EntityRef<'question' | 'decision'>,
): CurrentScopeClassificationContent {
  const item = objectValue(value, 'replay classification');
  const ref = versionRefOf(item.ref, scope, 'scope_classification', 'replay classification ref');
  const targetRef = entityRefValue(item.targetRef, scope, ['question', 'decision'], 'replay classification target');
  if (targetRef.kind !== expectedTarget.kind || targetRef.entityId !== expectedTarget.entityId) {
    return corrupt('replay classification 대상이 결과 대상과 다릅니다.');
  }
  const common = {
    ref,
    targetRef,
    reason: stringValue(item.reason, 'replay classification reason'),
    classifiedBy: stringValue(item.classifiedBy, 'replay classification actor'),
    classifiedAt: stringValue(item.classifiedAt, 'replay classification time'),
    ...(item.previousVersionRef === undefined ? {} : {
      previousVersionRef: versionRefOf(
        item.previousVersionRef,
        scope,
        'scope_classification',
        'replay previous classification ref',
      ),
    }),
    basisRefs: versionRefs(item.basisRefs, scope, 'replay classification basisRefs'),
  };
  if (item.scope === 'current' && (item.requiredGate === 'G1' || item.requiredGate === 'G2')) {
    return { ...common, scope: 'current', requiredGate: item.requiredGate };
  }
  if (item.scope !== 'followup' || item.requiredGate !== 'None') {
    return corrupt('replay classification scope와 gate가 올바르지 않습니다.');
  }
  const revisit = objectValue(item.revisit, 'replay classification revisit');
  const parsedRevisit = revisit.kind === 'at'
    ? { kind: 'at' as const, at: stringValue(revisit.at, 'replay revisit at') }
    : revisit.kind === 'event'
      ? { kind: 'event' as const, event: stringValue(revisit.event, 'replay revisit event') }
      : corrupt('replay classification revisit가 올바르지 않습니다.');
  return {
    ...common,
    scope: 'followup',
    requiredGate: 'None',
    ownerId: stringValue(item.ownerId, 'replay classification owner'),
    revisit: parsedRevisit,
  };
}

function proposalSource(value: unknown): { readonly draftId: string; readonly temporaryId: string } {
  const source = objectValue(value, 'replay sourceDraft');
  return {
    draftId: stringValue(source.draftId, 'replay source draftId'),
    temporaryId: stringValue(source.temporaryId, 'replay source temporaryId'),
  };
}

function questionResult(value: unknown, scope: SrScope, questionId: string): QContentFields['currentResult'] {
  const result = objectValue(value, 'replay question currentResult');
  const ref = versionRefOf(result.ref, scope, 'question_result', 'replay question result ref');
  if (ref.entityId !== questionId) return corrupt('replay question result ref가 질문과 다릅니다.');
  let selectedAnswer: QContentFields['currentResult']['selectedAnswer'];
  if (result.selectedAnswer !== undefined) {
    const selected = objectValue(result.selectedAnswer, 'replay selected answer');
    const answer = objectValue(selected.answer, 'replay answer');
    const parsedAnswer = answer.kind === 'choice'
      ? {
          kind: 'choice' as const,
          optionId: stringValue(answer.optionId, 'replay answer optionId'),
          text: stringValue(answer.text, 'replay answer text'),
        }
      : answer.kind === 'free_text'
        ? { kind: 'free_text' as const, text: stringValue(answer.text, 'replay answer text') }
        : corrupt('replay answer kind가 올바르지 않습니다.');
    const answeredQuestionSnapshotRef = versionRefOf(
      selected.answeredQuestionSnapshotRef,
      scope,
      'question_result',
      'replay answered question snapshot ref',
    );
    if (answeredQuestionSnapshotRef.entityId !== questionId) {
      return corrupt('replay answered question snapshot ref가 질문과 다릅니다.');
    }
    selectedAnswer = {
      ref: versionRefOf(selected.ref, scope, 'question_answer', 'replay selected answer ref'),
      answeredQuestionSnapshotRef,
      answer: parsedAnswer,
      evidence: evidence(selected.evidence, scope, 'replay selected answer evidence'),
      answeredBy: stringValue(selected.answeredBy, 'replay answer actor'),
      answeredAt: stringValue(selected.answeredAt, 'replay answer time'),
    };
  }
  let resolution: QContentFields['currentResult']['resolution'];
  if (result.resolution !== undefined) {
    const stored = objectValue(result.resolution, 'replay question resolution');
    const disposition = objectValue(stored.documentDisposition, 'replay document disposition');
    let documentDisposition: NonNullable<typeof resolution>['documentDisposition'];
    if (disposition.kind === 'reflected') {
      if (!Array.isArray(disposition.artifactVersionRefs) || disposition.artifactVersionRefs.length === 0) {
        return corrupt('replay reflected artifact refs가 비어 있습니다.');
      }
      documentDisposition = {
        kind: 'reflected',
        artifactVersionRefs: disposition.artifactVersionRefs.map((item, index) =>
          versionRefOf(item, scope, 'artifact', `replay artifact ref[${index}]`) as ArtifactVersionRef),
      };
    } else if (disposition.kind === 'not_required') {
      documentDisposition = {
        kind: 'not_required',
        reason: stringValue(disposition.reason, 'replay no-change reason'),
      };
    } else {
      return corrupt('replay document disposition kind가 올바르지 않습니다.');
    }
    resolution = {
      selectedAnswerRef: versionRefOf(
        stored.selectedAnswerRef,
        scope,
        'question_answer',
        'replay resolution selected answer ref',
      ),
      evidence: evidence(stored.evidence, scope, 'replay resolution evidence'),
      documentDisposition,
      resolvedBy: stringValue(stored.resolvedBy, 'replay resolution actor'),
      resolvedAt: stringValue(stored.resolvedAt, 'replay resolution time'),
    };
  }
  if (resolution !== undefined && (selectedAnswer === undefined ||
    !sameRef(resolution.selectedAnswerRef, selectedAnswer.ref))) {
    return corrupt('replay resolution과 선택 답변이 다릅니다.');
  }
  return {
    ref,
    capturedAt: stringValue(result.capturedAt, 'replay question result time'),
    evidenceRefs: evidenceRefs(result.evidenceRefs, scope, 'replay question evidenceRefs'),
    ...(selectedAnswer === undefined ? {} : { selectedAnswer }),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

export function decodeQuestionReplay(value: unknown, expectedScope: SrScope): QuestionView {
  const stored = objectValue(value, 'question replay');
  const scope = scopeValue(stored.scope, expectedScope);
  const questionId = stringValue(stored.questionId, 'replay questionId');
  const targetRef: EntityRef<'question'> = {
    kind: 'question', projectId: scope.projectId, srId: scope.srId, entityId: questionId,
  };
  const classification = currentClassification(stored.currentClassification, scope, targetRef);
  const classificationRef = versionRefOf(
    stored.classificationRef,
    scope,
    'scope_classification',
    'replay question classification ref',
  );
  if (!sameRef(classificationRef, classification.ref) || stored.requiredGate !== classification.requiredGate) {
    return corrupt('replay question의 현재 classification이 일치하지 않습니다.');
  }
  const status = stored.status;
  if (status !== 'open' && status !== 'answered' && status !== 'resolved' && status !== 'converted_to_decision') {
    return corrupt('replay question status가 올바르지 않습니다.');
  }
  const answerMode = stored.answerMode;
  if (answerMode !== 'choice' && answerMode !== 'free_text') return corrupt('replay answerMode가 올바르지 않습니다.');
  if (!Array.isArray(stored.options)) return corrupt('replay question options가 배열이 아닙니다.');
  const options = stored.options.map((value, index) => {
    const option = objectValue(value, `replay question option[${index}]`);
    return {
      optionId: stringValue(option.optionId, `replay question option[${index}] optionId`),
      text: stringValue(option.text, `replay question option[${index}] text`),
    };
  });
  if ((answerMode === 'choice' && options.length === 0) || (answerMode === 'free_text' && options.length !== 0)) {
    return corrupt('replay question answerMode와 options가 일치하지 않습니다.');
  }
  const currentResult = questionResult(stored.currentResult, scope, questionId);
  if ((status === 'answered' || status === 'resolved') && currentResult.selectedAnswer === undefined) {
    return corrupt('replay answered/resolved question에 선택 답변이 없습니다.');
  }
  if ((status === 'resolved') !== (currentResult.resolution !== undefined)) {
    return corrupt('replay question status와 resolution이 일치하지 않습니다.');
  }
  const convertedDecisionId = stored.convertedDecisionId === undefined
    ? undefined
    : stringValue(stored.convertedDecisionId, 'replay converted decisionId');
  if ((status === 'converted_to_decision') !== (convertedDecisionId !== undefined)) {
    return corrupt('replay converted question 연결이 올바르지 않습니다.');
  }
  return {
    scope,
    questionId,
    status,
    text: stringValue(stored.text, 'replay question text'),
    reason: stringValue(stored.reason, 'replay question reason'),
    assigneeId: stringValue(stored.assigneeId, 'replay question assignee'),
    answerMode,
    options,
    requiredGate: classification.requiredGate,
    classificationRef,
    currentClassification: classification,
    ...(stored.parentQuestionId === undefined
      ? {}
      : { parentQuestionId: stringValue(stored.parentQuestionId, 'replay parent questionId') }),
    candidateAnswers: stringArray(stored.candidateAnswers, 'replay candidateAnswers'),
    relatedArtifactRefs: (() => {
      if (!Array.isArray(stored.relatedArtifactRefs)) return corrupt('replay relatedArtifactRefs가 배열이 아닙니다.');
      return stored.relatedArtifactRefs.map((item, index) =>
        versionRefOf(item, scope, 'artifact', `replay related artifact ref[${index}]`) as ArtifactVersionRef);
    })(),
    sourceRefs: versionRefs(stored.sourceRefs, scope, 'replay question sourceRefs'),
    ...(stored.dueAt === undefined ? {} : { dueAt: stringValue(stored.dueAt, 'replay question dueAt') }),
    ...(stored.sourceDraft === undefined ? {} : { sourceDraft: proposalSource(stored.sourceDraft) }),
    ...(convertedDecisionId === undefined ? {} : { convertedDecisionId }),
    createdAt: stringValue(stored.createdAt, 'replay question createdAt'),
    currentResult,
    revision: integerValue(stored.revision, 'replay question revision'),
    allowedActions: stringArray(stored.allowedActions, 'replay question allowedActions'),
    reviewImpact: reviewImpact(stored.reviewImpact),
  };
}

function decisionConfirmation(
  value: unknown,
  scope: SrScope,
  decisionId: string,
): NonNullable<DecisionContentFields['currentConfirmation']> {
  const stored = objectValue(value, 'replay decision confirmation');
  const ref = versionRefOf(stored.ref, scope, 'decision', 'replay decision version ref');
  if (ref.entityId !== decisionId) return corrupt('replay decision version ref가 decision과 다릅니다.');
  const selection = objectValue(stored.selection, 'replay decision selection');
  const originQuestionId = stored.originQuestionId === undefined
    ? undefined
    : stringValue(stored.originQuestionId, 'replay decision origin questionId');
  const originQuestionResultSnapshotRef = stored.originQuestionResultSnapshotRef === undefined
    ? undefined
    : versionRefOf(
        stored.originQuestionResultSnapshotRef,
        scope,
        'question_result',
        'replay decision origin question result ref',
      );
  if ((originQuestionId === undefined) !== (originQuestionResultSnapshotRef === undefined) ||
    (originQuestionId !== undefined && originQuestionResultSnapshotRef?.entityId !== originQuestionId)) {
    return corrupt('replay decision origin question 근거가 불완전합니다.');
  }
  return {
    ref,
    selection: {
      ...(selection.optionId === undefined
        ? {}
        : { optionId: stringValue(selection.optionId, 'replay decision optionId') }),
      text: stringValue(selection.text, 'replay decision selection text'),
    },
    rationale: stringValue(stored.rationale, 'replay decision rationale'),
    evidence: evidence(stored.evidence, scope, 'replay decision evidence'),
    decidedBy: stringValue(stored.decidedBy, 'replay decision actor'),
    decidedAt: stringValue(stored.decidedAt, 'replay decision time'),
    classificationRef: versionRefOf(
      stored.classificationRef,
      scope,
      'scope_classification',
      'replay decision confirmation classification ref',
    ),
    ...(originQuestionId === undefined ? {} : { originQuestionId }),
    ...(originQuestionResultSnapshotRef === undefined ? {} : { originQuestionResultSnapshotRef }),
    ...(stored.previousVersionRef === undefined ? {} : {
      previousVersionRef: versionRefOf(
        stored.previousVersionRef,
        scope,
        'decision',
        'replay previous decision ref',
      ),
    }),
    ...(stored.changeReason === undefined
      ? {}
      : { changeReason: stringValue(stored.changeReason, 'replay decision changeReason') }),
  };
}

export function decodeDecisionReplay(value: unknown, expectedScope: SrScope): DecisionView {
  const stored = objectValue(value, 'decision replay');
  const scope = scopeValue(stored.scope, expectedScope);
  const decisionId = stringValue(stored.decisionId, 'replay decisionId');
  const targetRef: EntityRef<'decision'> = {
    kind: 'decision', projectId: scope.projectId, srId: scope.srId, entityId: decisionId,
  };
  const classification = currentClassification(stored.currentClassification, scope, targetRef);
  const classificationRef = versionRefOf(
    stored.classificationRef,
    scope,
    'scope_classification',
    'replay decision classification ref',
  );
  if (!sameRef(classificationRef, classification.ref) || stored.requiredGate !== classification.requiredGate) {
    return corrupt('replay decision의 현재 classification이 일치하지 않습니다.');
  }
  if (!Array.isArray(stored.alternatives)) return corrupt('replay decision alternatives가 배열이 아닙니다.');
  const alternatives = stored.alternatives.map((value, index) => {
    const alternative = objectValue(value, `replay decision alternative[${index}]`);
    return {
      optionId: stringValue(alternative.optionId, `replay decision alternative[${index}] optionId`),
      label: stringValue(alternative.label, `replay decision alternative[${index}] label`),
      description: stringValue(alternative.description, `replay decision alternative[${index}] description`),
    };
  });
  if (alternatives.length === 0) return corrupt('replay decision alternatives가 비어 있습니다.');
  const state = stored.state;
  if (state !== 'unconfirmed' && state !== 'confirmed') return corrupt('replay decision state가 올바르지 않습니다.');
  const currentConfirmation = stored.currentConfirmation === undefined
    ? undefined
    : decisionConfirmation(stored.currentConfirmation, scope, decisionId);
  if ((state === 'confirmed') !== (currentConfirmation !== undefined)) {
    return corrupt('replay decision state와 confirmation이 일치하지 않습니다.');
  }
  if (currentConfirmation !== undefined && !sameRef(currentConfirmation.classificationRef, classificationRef)) {
    return corrupt('replay decision confirmation classification이 현재 값과 다릅니다.');
  }
  const originQuestionId = stored.originQuestionId === undefined
    ? undefined
    : stringValue(stored.originQuestionId, 'replay decision origin questionId');
  const originQuestionResultSnapshotRef = stored.originQuestionResultSnapshotRef === undefined
    ? undefined
    : versionRefOf(
        stored.originQuestionResultSnapshotRef,
        scope,
        'question_result',
        'replay decision origin question result ref',
      );
  if ((originQuestionId === undefined) !== (originQuestionResultSnapshotRef === undefined) ||
    (originQuestionId !== undefined && originQuestionResultSnapshotRef?.entityId !== originQuestionId)) {
    return corrupt('replay decision origin question 근거가 불완전합니다.');
  }
  return {
    scope,
    decisionId,
    state,
    prompt: stringValue(stored.prompt, 'replay decision prompt'),
    alternatives,
    impact: stringValue(stored.impact, 'replay decision impact'),
    decisionMakerId: stringValue(stored.decisionMakerId, 'replay decision maker'),
    requiredGate: classification.requiredGate,
    classificationRef,
    currentClassification: classification,
    ...(stored.recommendation === undefined
      ? {}
      : { recommendation: stringValue(stored.recommendation, 'replay decision recommendation') }),
    sourceRefs: versionRefs(stored.sourceRefs, scope, 'replay decision sourceRefs'),
    ...(originQuestionId === undefined ? {} : { originQuestionId }),
    ...(originQuestionResultSnapshotRef === undefined ? {} : { originQuestionResultSnapshotRef }),
    ...(stored.sourceDraft === undefined ? {} : { sourceDraft: proposalSource(stored.sourceDraft) }),
    createdBy: stringValue(stored.createdBy, 'replay decision creator'),
    createdAt: stringValue(stored.createdAt, 'replay decision createdAt'),
    ...(currentConfirmation === undefined ? {} : { currentConfirmation }),
    revision: integerValue(stored.revision, 'replay decision revision'),
    allowedActions: stringArray(stored.allowedActions, 'replay decision allowedActions'),
    reviewImpact: reviewImpact(stored.reviewImpact),
  };
}

export function decodeScopeReplay(value: unknown, expectedScope: SrScope): ScopeView {
  const stored = objectValue(value, 'scope replay');
  const targetRef = entityRefValue(
    stored.targetRef,
    expectedScope,
    ['question', 'decision'],
    'replay scope target',
  );
  const classification = currentClassification(stored.classification, expectedScope, targetRef);
  const classificationRef = versionRefOf(
    stored.classificationRef,
    expectedScope,
    'scope_classification',
    'replay scope classification ref',
  );
  if (!sameRef(classificationRef, classification.ref) || stored.scope !== classification.scope ||
    stored.requiredGate !== classification.requiredGate) {
    return corrupt('replay ScopeView와 classification이 일치하지 않습니다.');
  }
  return {
    targetRef,
    classificationRef,
    classification,
    scope: classification.scope,
    requiredGate: classification.requiredGate,
    revision: integerValue(stored.revision, 'replay scope revision'),
    reviewImpact: reviewImpact(stored.reviewImpact),
  };
}
