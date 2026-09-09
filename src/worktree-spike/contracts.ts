export const RESUME_PROMPT = 'aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.';

export type WorktreeReadiness = 'absent' | 'ready';
export type WorktreeRunStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface WorktreeHandle {
  srId: string;
  repositoryRoot: string;
  branch: string;
  worktreeRoot: string;
  readiness: WorktreeReadiness;
}

export interface ParsedAidlcState {
  statePath: string;
  currentStage?: string;
  firstIncomplete?: string;
  status: 'missing' | 'parsed';
}

export interface ManifestEntry {
  path: string;
  hash: string;
}

export interface ScopedManifest {
  entries: ManifestEntry[];
}

export interface ManifestDelta {
  before: ScopedManifest;
  after: ScopedManifest;
  created: string[];
  modified: string[];
  deleted: string[];
}

export interface RunRequest {
  srId: string;
  worktreeRoot: string;
  prompt: typeof RESUME_PROMPT;
  operationId: string;
}

export interface WorktreeRunResult {
  exitCode: number;
  stdout: string;
}

export interface WorktreeSpikeView {
  srId: string;
  configured: boolean;
  readiness: WorktreeReadiness;
  branch?: string;
  worktreeRoot?: string;
  currentStage?: string;
  firstIncomplete?: string;
  runStatus: WorktreeRunStatus;
  changedPaths: string[];
  error?: string;
}

export interface GitWorktreePort {
  provision(repositoryRoot: string, workspaceRoot: string, srId: string): Promise<WorktreeHandle>;
}

export interface AidlcStateParserPort {
  parse(worktreeRoot: string): Promise<ParsedAidlcState>;
}

export interface ManifestPort {
  capture(worktreeRoot: string): Promise<ScopedManifest>;
  diff(before: ScopedManifest, after: ScopedManifest): ManifestDelta;
}

export interface WorktreeAidlcRunnerPort {
  run(request: RunRequest): Promise<WorktreeRunResult>;
  close(): Promise<void>;
}
