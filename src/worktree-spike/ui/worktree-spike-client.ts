import { api, record, type ApiClient, type Guard } from '../../shared/client/api-client.js';
import type { WorktreeDocumentEditRequest, WorktreeDocumentEditResult, WorktreeDocumentVersionSummary, WorktreeDocumentView, WorktreeSpikeView, WorktreeTranscriptEntry } from '../contracts.js';

const keys = new Set(['srId', 'configured', 'readiness', 'branch', 'worktreeRoot', 'currentStage', 'firstIncomplete', 'runStatus', 'sessionId', 'interactionStatus', 'transcript', 'changedPaths', 'documents', 'error']);
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isTranscriptEntry = (value: unknown): value is WorktreeTranscriptEntry => record(value)
  && Object.keys(value).every(key => ['sequence', 'role', 'text', 'createdAt'].includes(key))
  && Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0
  && ['user', 'assistant', 'status', 'error'].includes(String(value.role))
  && typeof value.text === 'string' && typeof value.createdAt === 'string';
const isDocumentSummary = (value: unknown) => record(value)
  && Object.keys(value).every(key => ['srId', 'path', 'versionId', 'versionNumber', 'hash', 'origin', 'createdAt', 'previousVersionId', 'sourceOperationId', 'change', 'editable'].includes(key))
  && typeof value.srId === 'string' && typeof value.path === 'string' && typeof value.versionId === 'string'
  && Number.isSafeInteger(value.versionNumber) && Number(value.versionNumber) > 0
  && (value.change === 'created' || value.change === 'modified' || value.change === 'unchanged')
  && typeof value.hash === 'string'
  && /^[a-f0-9]{64}$/.test(value.hash)
  && (value.origin === 'ai_generated' || value.origin === 'human_edit')
  && typeof value.createdAt === 'string' && typeof value.editable === 'boolean'
  && optionalString(value.previousVersionId) && optionalString(value.sourceOperationId);

export const isWorktreeDocumentVersionSummary: Guard<WorktreeDocumentVersionSummary> = (value): value is WorktreeDocumentVersionSummary => record(value)
  && Object.keys(value).every(key => ['srId', 'path', 'versionId', 'versionNumber', 'hash', 'origin', 'createdAt', 'previousVersionId', 'sourceOperationId'].includes(key))
  && typeof value.srId === 'string' && typeof value.path === 'string' && typeof value.versionId === 'string'
  && Number.isSafeInteger(value.versionNumber) && Number(value.versionNumber) > 0
  && typeof value.hash === 'string' && /^[a-f0-9]{64}$/.test(value.hash)
  && (value.origin === 'ai_generated' || value.origin === 'human_edit') && typeof value.createdAt === 'string'
  && optionalString(value.previousVersionId) && optionalString(value.sourceOperationId);

export const isWorktreeDocumentView: Guard<WorktreeDocumentView> = (value): value is WorktreeDocumentView => record(value)
  && Object.keys(value).every(key => ['srId', 'path', 'versionId', 'versionNumber', 'hash', 'origin', 'createdAt', 'previousVersionId', 'sourceOperationId', 'change', 'editable', 'body', 'isLatest'].includes(key))
  && isDocumentSummary(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'body' && key !== 'isLatest')))
  && typeof value.body === 'string' && typeof value.isLatest === 'boolean';

export const isWorktreeDocumentVersionPage = (value: unknown): value is { items: WorktreeDocumentVersionSummary[]; nextCursor: string | null } => record(value)
  && Object.keys(value).every(key => ['items', 'nextCursor'].includes(key))
  && Array.isArray(value.items) && value.items.every(isWorktreeDocumentVersionSummary)
  && (value.nextCursor === null || typeof value.nextCursor === 'string');

export const isWorktreeDocumentEditResult: Guard<WorktreeDocumentEditResult> = (value): value is WorktreeDocumentEditResult => record(value)
  && Object.keys(value).every(key => ['view', 'changed'].includes(key))
  && isWorktreeDocumentView(value.view) && typeof value.changed === 'boolean';

export const isWorktreeSpikeView: Guard<WorktreeSpikeView> = (value): value is WorktreeSpikeView => record(value)
  && Object.keys(value).every(key => keys.has(key))
  && typeof value.srId === 'string'
  && typeof value.configured === 'boolean'
  && (value.readiness === 'absent' || value.readiness === 'ready')
  && optionalString(value.branch)
  && optionalString(value.worktreeRoot)
  && optionalString(value.currentStage)
  && optionalString(value.firstIncomplete)
  && ['idle', 'running', 'succeeded', 'failed'].includes(String(value.runStatus))
  && optionalString(value.sessionId)
  && (value.interactionStatus === undefined || ['idle', 'running', 'awaiting_input', 'finishing', 'succeeded', 'failed', 'cancelled'].includes(String(value.interactionStatus)))
  && (value.transcript === undefined || (Array.isArray(value.transcript) && value.transcript.every(isTranscriptEntry)))
  && Array.isArray(value.changedPaths)
  && value.changedPaths.every(path => typeof path === 'string')
  && Array.isArray(value.documents)
  && value.documents.every(isDocumentSummary)
  && optionalString(value.error);

export const worktreeSpikePath = (srId: string) => `/api/srs/${encodeURIComponent(srId)}/worktree-spike`;

export class WorktreeSpikeClient {
  constructor(
    private readonly client: ApiClient = api,
    private readonly operationId: () => string = () => crypto.randomUUID(),
  ) {}

  status(srId: string): Promise<WorktreeSpikeView> {
    return this.client.request(worktreeSpikePath(srId), isWorktreeSpikeView);
  }

  provision(srId: string): Promise<WorktreeSpikeView> {
    return this.mutate(srId, 'provision');
  }

  resume(srId: string): Promise<WorktreeSpikeView> {
    return this.mutate(srId, 'resume');
  }

  message(srId: string, message: string): Promise<WorktreeSpikeView> {
    return this.mutate(srId, 'message', { message });
  }

  finish(srId: string): Promise<WorktreeSpikeView> {
    return this.mutate(srId, 'finish');
  }

  cancel(srId: string): Promise<WorktreeSpikeView> {
    return this.mutate(srId, 'cancel');
  }

  document(srId: string, path: string, versionId?: string): Promise<WorktreeDocumentView> {
    const version = versionId ? `&versionId=${encodeURIComponent(versionId)}` : '';
    return this.client.request(`${worktreeSpikePath(srId)}/document?path=${encodeURIComponent(path)}${version}`, isWorktreeDocumentView);
  }

  versions(srId: string, path: string): Promise<{ items: WorktreeDocumentVersionSummary[]; nextCursor: string | null }> {
    return this.client.request(`${worktreeSpikePath(srId)}/document/versions?path=${encodeURIComponent(path)}`, isWorktreeDocumentVersionPage);
  }

  edit(srId: string, request: WorktreeDocumentEditRequest): Promise<WorktreeDocumentEditResult> {
    return this.client.request(`${worktreeSpikePath(srId)}/document/edits`, isWorktreeDocumentEditResult, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': this.operationId() }, body: JSON.stringify(request),
    });
  }

  private mutate(srId: string, action: 'provision' | 'resume' | 'message' | 'finish' | 'cancel', body: Record<string, unknown> = {}): Promise<WorktreeSpikeView> {
    return this.client.request(`${worktreeSpikePath(srId)}/${action}`, isWorktreeSpikeView, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operation-Id': this.operationId() },
      body: JSON.stringify(body),
    });
  }
}

export const worktreeSpikeClient = new WorktreeSpikeClient();
