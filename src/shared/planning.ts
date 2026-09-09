import type { AppError, DocumentView, GeneratedArtifact, Result, SR, VersionRef } from './contracts.js';
export type PlanningStage = 'requirements_analysis' | 'inception' | 'construction';
export type PlanningAction = 'start' | 'revise' | 'next';
export interface Question { id: string; prompt: string }
export interface QuestionSet { id: string; runId: string; stage: PlanningStage; questions: Question[]; answers?: Record<string, string> }
export interface PlanningDecision { id: string; stage: PlanningStage; kind: 'approve' | 'request_changes'; note: string; targets: VersionRef[]; createdAt: string }
export interface WorkflowState {
  srId: string; revision: number; stage: PlanningStage | null; cycle: number;
  status: 'idle' | 'running' | 'awaiting_answers' | 'awaiting_approval' | 'approved' | 'changes_requested' | 'failed' | 'complete';
  activeRunId?: string; lastRunId?: string; questionSet?: QuestionSet;
  decisions: PlanningDecision[]; stageRefs: VersionRef[];
}
export interface RunView {
  id: string; srId: string; stage: PlanningStage; cycle: number;
  status: 'running' | 'succeeded' | 'failed'; createdAt: string; finishedAt?: string;
  inputRefs: VersionRef[]; outputRefs: VersionRef[]; error?: AppError;
}
export interface WorkflowView extends WorkflowState { allowedActions: PlanningAction[]; canComplete: boolean; lastRun?: RunView }
export interface RunnerOutcome { artifacts: GeneratedArtifact[]; questions: Question[]; suggestion?: string }
export interface ContextSnapshot { sr: SR; run: RunView; documents: DocumentView[]; workflow: WorkflowState; rules: string; reviews: unknown[] }
export interface ExecutionScope { signal?: AbortSignal }
export interface PlanRunnerPort { execute(context: ContextSnapshot, scope: ExecutionScope): Promise<Result<RunnerOutcome>> }
export interface ActionEvaluation { stage: PlanningStage; cycle: number }
export const initialWorkflow = (srId: string): WorkflowState => ({ srId, revision: 0, stage: null, cycle: 0, status: 'idle', decisions: [], stageRefs: [] });
