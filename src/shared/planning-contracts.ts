import type { AppError, DocumentView, GeneratedArtifact, HistoryEvent, Result, SR, VersionRef } from './contracts.js';
import type { Column } from './limits.js';

export const PLANNING_STAGES = [
  { id: 'requirements-analysis', label: '요구사항 분석', column: 'requirements_analysis', rule: 'inception/requirements-analysis.md' },
  { id: 'user-stories', label: '사용자 스토리', column: 'inception', rule: 'inception/user-stories.md' },
  { id: 'workflow-planning', label: '워크플로우 계획', column: 'inception', rule: 'inception/workflow-planning.md' },
  { id: 'application-design', label: '애플리케이션 설계', column: 'inception', rule: 'inception/application-design.md' },
  { id: 'units-generation', label: '작업 단위', column: 'inception', rule: 'inception/units-generation.md' },
  { id: 'functional-design', label: '기능 설계', column: 'construction', rule: 'construction/functional-design.md' },
  { id: 'nfr-requirements', label: '비기능 요구사항', column: 'construction', rule: 'construction/nfr-requirements.md' },
  { id: 'nfr-design', label: '비기능 설계', column: 'construction', rule: 'construction/nfr-design.md' },
  { id: 'code-generation-plan', label: '코드 구현 계획', column: 'construction', rule: 'construction/code-generation.md' },
] as const;
export type StageId = typeof PLANNING_STAGES[number]['id'];
export type PlanningAction = 'generate' | 'revise' | 'next';
export type PlanningStatus = 'idle' | 'running' | 'awaiting_answers' | 'awaiting_approval' | 'approved' | 'changes_requested' | 'failed' | 'complete';
export interface PlanningQuestion { id: string; prompt: string; options: string[] }
export interface QuestionSet { id: string; runId: string; stage: StageId; questions: PlanningQuestion[]; answers?: Record<string, string> }
export interface PlanningDecision { id: string; stage: StageId; runId: string; kind: 'approve' | 'request_changes'; comment: string; targets: VersionRef[]; createdAt: string }
export interface WorkflowState {
  srId: string; revision: number; stageIndex: number; column: Column; status: PlanningStatus;
  inceptionCycle: number; constructionCycle: number; latestRunId?: string;
  questionSet?: QuestionSet; decision?: PlanningDecision; reviewTargets: VersionRef[];
}
export interface ActionEvaluation { action: PlanningAction; stageIndex: number; stage: StageId; column: Column; inceptionCycle: number; constructionCycle: number }
export interface WorkflowView extends WorkflowState {
  stage: StageId; stageLabel: string; actions: PlanningAction[]; canComplete: boolean; blockedReason?: string; latestRun?: RunView;
}
export interface RunnerOutcome { artifacts: GeneratedArtifact[]; questions: PlanningQuestion[]; summary: string }
export interface RunView {
  id: string; srId: string; stage: StageId; status: 'running' | 'succeeded' | 'failed';
  startedAt: string; completedAt?: string; error?: AppError; outputRefs: VersionRef[]; summary?: string;
}
export interface ContextSnapshot {
  sr: SR; runId: string; stage: StageId; workflow: WorkflowState; documents: (DocumentView & { logicalKey: string })[];
  history: HistoryEvent[]; rules: string; scope: 'planning-only'; finalize: boolean;
}
export interface PlanningRun extends RunView { inputRefs: VersionRef[]; context?: ContextSnapshot }
export interface RunSpecification { stage: StageId; workflow: WorkflowState; finalize?: boolean }
export interface ExecutionScope { signal?: AbortSignal }
export interface PlanRunnerPort { execute(context: ContextSnapshot, scope: ExecutionScope): Promise<Result<RunnerOutcome>>; close?(): Promise<void> }
export interface DecisionInput { kind: 'approve' | 'request_changes'; comment: string; targets: VersionRef[]; revision: number }
export interface AnswerSubmission { answers: Record<string, string>; revision: number }
export const PLANNING_LIMITS = { documents: 100, contextBytes: 8 * 1024 * 1024, outputBytes: 8 * 1024 * 1024, questions: 20, questionBytes: 8192, answerBytes: 65536, timeoutMs: 300000 } as const;
