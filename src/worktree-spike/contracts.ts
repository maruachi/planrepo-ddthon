export const RESUME_PROMPT = 'aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.';
export const INITIAL_WORKFLOW_PROMPT_CLOSING = '위 SR 요구사항 명세서를 기준으로 requirements 문서를 작성하고 AI-DLC workflows 진행합시다.';
export const WORKTREE_RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
export const WORKTREE_MESSAGE_BYTES = 16 * 1024;
export const WORKTREE_TRANSCRIPT_BYTES = 256 * 1024;
export const WORKTREE_TRANSCRIPT_ENTRIES = 500;

export interface WorktreeSrRequirements {
  title: string;
  description: string;
  attachmentMarkdown?: string;
  attachmentDisplayName?: string;
}

export interface WorktreeSrRequirementsPort {
  get(srId: string): WorktreeSrRequirements;
}

export function buildInitialWorkflowPrompt(requirements: WorktreeSrRequirements): string {
  const sections = [
    '# SR 요구사항 명세서',
    '',
    '## 제목',
    requirements.title,
    '',
    '## 요구사항',
    requirements.description,
  ];
  if (requirements.attachmentMarkdown !== undefined) {
    sections.push('', '## 첨부 요구사항 명세서', requirements.attachmentDisplayName ?? '첨부 문서', '', requirements.attachmentMarkdown);
  }
  sections.push('', INITIAL_WORKFLOW_PROMPT_CLOSING);
  return sections.join('\n');
}

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
  prompt: string;
  operationId: string;
}

export interface WorktreeRunResult {
  exitCode: number;
  stdout: string;
}

export type WorktreeInteractionStatus = 'idle' | 'running' | 'awaiting_input' | 'finishing' | 'succeeded' | 'failed' | 'cancelled';
export type WorktreeTranscriptRole = 'user' | 'assistant' | 'status' | 'error';

export interface WorktreeTranscriptEntry {
  sequence: number;
  role: WorktreeTranscriptRole;
  text: string;
  createdAt: string;
}

export interface WorktreeStreamEvent {
  role: WorktreeTranscriptRole;
  text: string;
  sessionId?: string;
  turnComplete?: boolean;
}

export interface InteractiveRunRequest extends Omit<RunRequest, 'prompt'> {
  prompt: string;
  sessionId: string;
  resume: boolean;
}

export interface WorktreeRunHandle {
  sessionId: string;
  completion: Promise<WorktreeRunResult>;
  send(message: string): Promise<void>;
  finish(): void;
  cancel(): void;
}

export type WorktreeDocumentChange = 'created' | 'modified' | 'unchanged';
export type WorktreeDocumentOrigin = 'ai_generated' | 'human_edit';

export interface WorktreeDocumentVersionSummary {
  srId: string;
  path: string;
  versionId: string;
  versionNumber: number;
  hash: string;
  origin: WorktreeDocumentOrigin;
  createdAt: string;
  previousVersionId?: string;
  sourceOperationId?: string;
}

export interface WorktreeDocumentSummary extends WorktreeDocumentVersionSummary {
  change: WorktreeDocumentChange;
  editable: boolean;
}

export interface WorktreeDocumentVersionView extends WorktreeDocumentVersionSummary {
  body: string;
  isLatest: boolean;
  change: WorktreeDocumentChange;
  editable: boolean;
}

export type WorktreeDocumentView = WorktreeDocumentVersionView;

export interface WorktreeDocumentEditRequest {
  path: string;
  expectedHash: string;
  body: string;
}

export interface WorktreeDocumentEditResult {
  view: WorktreeDocumentVersionView;
  changed: boolean;
}

export interface WorktreeDocumentSnapshot {
  srId: string;
  path: string;
  hash: string;
  body: string;
  origin: WorktreeDocumentOrigin;
  change: WorktreeDocumentChange;
  sourceOperationId?: string;
}

export interface WorktreeDocumentEditReceipt {
  operationId: string;
  fingerprint: string;
  result: WorktreeDocumentEditResult;
}

export interface WorktreeDocumentHistoryPort {
  recordSnapshot(snapshot: WorktreeDocumentSnapshot): WorktreeDocumentVersionView;
  listDocuments(srId: string): WorktreeDocumentSummary[];
  listVersions(srId: string, path: string): WorktreeDocumentVersionSummary[];
  readVersion(srId: string, path: string, versionId?: string): WorktreeDocumentVersionView;
  editReceipt(operationId: string, fingerprint: string): WorktreeDocumentEditResult | undefined;
  recordHumanEdit(input: WorktreeDocumentSnapshot & { operationId: string; fingerprint: string; expectedHash: string }): WorktreeDocumentEditResult;
}

export interface WorktreeDocumentWriteResult {
  changed: boolean;
  hash: string;
  body: string;
  rollback?: { body: Uint8Array; mode: number };
}

export interface WorktreeDocumentWriterPort {
  write(worktreeRoot: string, request: WorktreeDocumentEditRequest): Promise<WorktreeDocumentWriteResult>;
  restore(worktreeRoot: string, path: string, expectedHash: string, rollback: NonNullable<WorktreeDocumentWriteResult['rollback']>): Promise<void>;
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
  sessionId?: string;
  interactionStatus?: WorktreeInteractionStatus;
  transcript?: WorktreeTranscriptEntry[];
  changedPaths: string[];
  documents: WorktreeDocumentSummary[];
  error?: string;
}

export interface WorktreeSpikePersistencePort {
  load(srId: string): WorktreeSpikeView | undefined;
  save(view: WorktreeSpikeView): void;
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
  start?(request: InteractiveRunRequest, onEvent: (event: WorktreeStreamEvent) => void): WorktreeRunHandle;
  close(): Promise<void>;
}
