import type {
  DecisionConversion,
  DecisionRevision,
  DecisionView,
  QuestionResolution,
  QuestionView,
} from '@/src/contracts/views';

function sameVersionRef(
  left: { readonly kind: string; readonly projectId: string; readonly srId?: string; readonly entityId: string; readonly version: number },
  right: { readonly kind: string; readonly projectId: string; readonly srId?: string; readonly entityId: string; readonly version: number },
): boolean {
  return left.kind === right.kind && left.projectId === right.projectId && left.srId === right.srId &&
    left.entityId === right.entityId && left.version === right.version;
}

export function validateQuestionResolution(
  question: QuestionView,
  input: QuestionResolution,
): string | undefined {
  if (question.status === 'converted_to_decision') return '전환된 질문은 해결 확인할 수 없습니다.';
  if (question.status !== 'answered') return '답변된 질문만 해결 확인할 수 있습니다.';
  if (input.questionId !== question.questionId) return '해결할 question ID가 대상과 다릅니다.';
  const selected = question.currentResult.selectedAnswer;
  if (selected === undefined || !sameVersionRef(selected.ref, input.selectedAnswerRef)) {
    return '현재 질문 결과가 선택한 정확한 답변만 해결할 수 있습니다.';
  }
  if ('text' in input.resolutionEvidence && input.resolutionEvidence.text.trim().length === 0) {
    return '해결 근거가 비어 있습니다.';
  }
  if (input.documentDisposition.kind === 'not_required' &&
    input.documentDisposition.reason.trim().length === 0) return '문서 변경 불필요 이유가 비어 있습니다.';
  return undefined;
}

export function validateDecisionConversion(
  question: QuestionView,
  input: DecisionConversion,
): string | undefined {
  if (question.status === 'converted_to_decision') return '질문이 이미 decision으로 전환됐습니다.';
  if (input.questionId !== question.questionId) return '전환할 question ID가 대상과 다릅니다.';
  if (!sameVersionRef(question.currentResult.ref, input.questionResultSnapshotRef)) {
    return 'decision 전환이 현재 question result snapshot을 기준으로 하지 않습니다.';
  }
  if (!sameVersionRef(question.classificationRef, input.classificationRef)) {
    return 'decision 전환의 분류가 현재 질문 분류와 다릅니다.';
  }
  if (input.prompt.trim().length === 0 || input.impact.trim().length === 0) {
    return 'decision prompt 또는 영향이 비어 있습니다.';
  }
  if (input.alternatives.length === 0) return 'decision 대안이 비어 있습니다.';
  const ids = new Set<string>();
  for (const alternative of input.alternatives) {
    if (alternative.optionId.trim().length === 0 || alternative.label.trim().length === 0 ||
      alternative.description.trim().length === 0) return 'decision 대안 내용이 비어 있습니다.';
    if (ids.has(alternative.optionId)) return 'decision 대안 ID가 중복됩니다.';
    ids.add(alternative.optionId);
  }
  return undefined;
}

export function validateDecisionRevision(
  decision: DecisionView,
  input: DecisionRevision,
): string | undefined {
  if (decision.state !== 'confirmed' || decision.currentConfirmation === undefined) {
    return '확정된 decision만 재결정할 수 있습니다.';
  }
  if (input.decisionId !== decision.decisionId) return '재결정할 decision ID가 대상과 다릅니다.';
  if (!sameVersionRef(decision.currentConfirmation.ref, input.previousVersionRef)) {
    return '재결정이 현재 decision version을 기준으로 하지 않습니다.';
  }
  if (input.selection.text.trim().length === 0 || input.rationale.trim().length === 0 ||
    input.changeReason.trim().length === 0) return '재결정 선택·이유·변경 근거가 비어 있습니다.';
  if (input.selection.optionId !== undefined) {
    const option = decision.alternatives.find(({ optionId }) => optionId === input.selection.optionId);
    if (option === undefined || option.label !== input.selection.text) {
      return '재결정 선택이 현재 decision 대안과 다릅니다.';
    }
  }
  return undefined;
}
