import type { GateKind } from '@/src/contracts/context';
import type {
  DecisionConfirmation,
  DecisionView,
  QuestionAnswer,
  QuestionView,
} from '@/src/contracts/views';

export function affectedGatesFor(requiredGate: GateKind | 'None'): readonly GateKind[] {
  if (requiredGate === 'G1') return ['G1', 'G2'];
  if (requiredGate === 'G2') return ['G2'];
  return [];
}

export function validateQuestionAnswer(
  question: QuestionView,
  input: QuestionAnswer,
): string | undefined {
  if (question.status === 'converted_to_decision') return '전환된 질문에는 답변할 수 없습니다.';
  if (input.questionId !== question.questionId) return '답변의 question ID가 대상과 다릅니다.';
  const current = question.currentResult.ref;
  const requested = input.answeredQuestionSnapshotRef;
  if (
    requested.kind !== 'question_result' || requested.projectId !== current.projectId ||
    requested.srId !== current.srId || requested.entityId !== current.entityId ||
    requested.version !== current.version
  ) return '답변이 현재 question result snapshot을 기준으로 하지 않습니다.';
  if (input.answer.text.trim().length === 0) return '답변 내용이 비어 있습니다.';
  if (question.answerMode === 'free_text' && input.answer.kind === 'choice') {
    return 'free-text 질문에는 choice 답변을 선택할 수 없습니다.';
  }
  if (input.answer.kind === 'choice') {
    const selected = input.answer;
    if (!question.options.some((option) =>
      option.optionId === selected.optionId && option.text === selected.text)) {
      return '선택한 답변이 현재 질문 option과 다릅니다.';
    }
  }
  return undefined;
}

export function validateDecisionConfirmation(
  decision: DecisionView,
  input: DecisionConfirmation,
): string | undefined {
  if (decision.state !== 'unconfirmed') return '미확정 decision만 확정할 수 있습니다.';
  if (input.decisionId !== decision.decisionId) return '확정할 decision ID가 대상과 다릅니다.';
  if (input.selection.text.trim().length === 0) return '선택 내용이 비어 있습니다.';
  if (input.rationale.trim().length === 0) return '확정 이유가 비어 있습니다.';
  if (input.selection.optionId !== undefined) {
    const alternative = decision.alternatives.find((item) => item.optionId === input.selection.optionId);
    if (alternative === undefined || alternative.label !== input.selection.text) {
      return '선택한 대안이 현재 decision 정의와 다릅니다.';
    }
  }
  return undefined;
}
