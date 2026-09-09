import type { Result } from '../../shared/contracts.js';
import { fail, result } from '../../shared/errors.js';
import { PLANNING_STAGES, type ActionEvaluation, type PlanningAction, type RunnerOutcome, type WorkflowState } from '../../shared/planning-contracts.js';

export function initialWorkflow(srId: string): WorkflowState {
  return { srId, revision: 0, stageIndex: 0, column: 'sr_list', status: 'idle', inceptionCycle: 0, constructionCycle: 0, reviewTargets: [] };
}

function unresolvedQuestions(state: WorkflowState): boolean {
  return !!state.questionSet?.questions.some(question => !state.questionSet?.answers?.[question.id]?.trim());
}

export class PlanningPolicy {
  evaluate(state: WorkflowState, action: PlanningAction): Result<ActionEvaluation> {
    return result(() => {
      if (!PLANNING_STAGES[state.stageIndex] || state.status === 'running' || state.status === 'complete' || unresolvedQuestions(state)) {
        fail('PLANNING_ACTION_BLOCKED', '현재 상태에서는 계획을 실행할 수 없습니다. 실행 상태와 질문 응답을 확인해 주세요.');
      }
      let stageIndex = state.stageIndex;
      if (action === 'next') {
        if (state.status !== 'approved') fail('APPROVAL_REQUIRED', '현재 단계의 산출물을 먼저 승인해 주세요.');
        if (stageIndex === PLANNING_STAGES.length - 1) fail('PLANNING_ACTION_BLOCKED', '마지막 단계입니다. 계획 완료를 선택해 주세요.');
        stageIndex += 1;
      } else if (action === 'generate') {
        if (state.status !== 'idle' && state.status !== 'failed') fail('PLANNING_ACTION_BLOCKED', '현재 상태에서는 최초 생성 또는 실패 재시도만 할 수 있습니다.');
      } else if (action === 'revise') {
        if (!['awaiting_approval', 'approved', 'changes_requested'].includes(state.status)) fail('PLANNING_ACTION_BLOCKED', '검토 가능한 단계에서만 재생성할 수 있습니다.');
      } else {
        fail('VALIDATION_ERROR', '알 수 없는 계획 실행 요청입니다.');
      }
      const stage = PLANNING_STAGES[stageIndex]!;
      let { inceptionCycle, constructionCycle } = state;
      if (stage.column === 'inception') inceptionCycle = inceptionCycle === 0 ? 1 : inceptionCycle + (action === 'revise' ? 1 : 0);
      if (stage.column === 'construction') constructionCycle = constructionCycle === 0 ? 1 : constructionCycle + (action === 'revise' ? 1 : 0);
      return { action, stageIndex, stage: stage.id, column: stage.column, inceptionCycle, constructionCycle };
    });
  }

  evaluateOutcome(state: WorkflowState, outcome: RunnerOutcome): Result<WorkflowState> {
    return result(() => {
      if (state.status !== 'running') fail('PLANNING_ACTION_BLOCKED', '실행 중인 계획만 결과를 반영할 수 있습니다.');
      if (outcome.artifacts.length === 0 && outcome.questions.length === 0) fail('INVALID_RUN_OUTPUT', '계획 결과에 문서 또는 질문이 필요합니다.');
      const updated: WorkflowState = { ...state, status: outcome.questions.length > 0 ? 'awaiting_answers' : 'awaiting_approval', reviewTargets: [] };
      delete updated.decision;
      delete updated.questionSet;
      return updated;
    });
  }
}
