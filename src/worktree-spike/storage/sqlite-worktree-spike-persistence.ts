import type Database from 'better-sqlite3';
import type { WorktreeDocumentSummary, WorktreeInteractionStatus, WorktreeSpikePersistencePort, WorktreeSpikeView, WorktreeTranscriptEntry } from '../contracts.js';
import { isEditableWorktreeDocumentPath } from '../files/worktree-document-reader.js';

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERACTION_STATUSES = new Set<WorktreeInteractionStatus>(['idle', 'running', 'awaiting_input', 'finishing', 'succeeded', 'failed', 'cancelled']);
const TRANSCRIPT_ROLES = new Set<WorktreeTranscriptEntry['role']>(['user', 'assistant', 'status', 'error']);
const document = (value: unknown, srId: string): WorktreeDocumentSummary | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.path !== 'string' || !['created', 'modified', 'unchanged'].includes(String(item.change)) || typeof item.hash !== 'string' || !SHA256.test(item.hash)) return undefined;
  if (item.srId === undefined) return { srId, path: item.path, change: item.change as WorktreeDocumentSummary['change'], hash: item.hash, editable: isEditableWorktreeDocumentPath(item.path), versionId: `legacy:${item.hash}`, versionNumber: 1, origin: 'ai_generated', createdAt: '1970-01-01T00:00:00.000Z' };
  if (item.srId !== srId || typeof item.versionId !== 'string' || !Number.isSafeInteger(item.versionNumber) || Number(item.versionNumber) < 1
    || (item.origin !== 'ai_generated' && item.origin !== 'human_edit') || typeof item.createdAt !== 'string' || typeof item.editable !== 'boolean'
    || (item.previousVersionId !== undefined && typeof item.previousVersionId !== 'string') || (item.sourceOperationId !== undefined && typeof item.sourceOperationId !== 'string')) return undefined;
  return item as unknown as WorktreeDocumentSummary;
};

function parse(payload: string): WorktreeSpikeView {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid persisted worktree spike state');
  const view = value as Record<string, unknown>;
  if (typeof view.srId !== 'string' || typeof view.configured !== 'boolean' || (view.readiness !== 'absent' && view.readiness !== 'ready')
    || (view.runStatus !== 'idle' && view.runStatus !== 'running' && view.runStatus !== 'succeeded' && view.runStatus !== 'failed')
    || !Array.isArray(view.changedPaths) || !view.changedPaths.every(path => typeof path === 'string')
    || !Array.isArray(view.documents)) throw new Error('Invalid persisted worktree spike state');
  const persistedSrId = view.srId;
  const documents = view.documents.map(item => document(item, persistedSrId));
  if (documents.some(item => !item)) throw new Error('Invalid persisted worktree spike state');
  for (const key of ['branch', 'worktreeRoot', 'currentStage', 'firstIncomplete', 'error']) if (view[key] !== undefined && typeof view[key] !== 'string') throw new Error('Invalid persisted worktree spike state');
  if (view.sessionId !== undefined && (typeof view.sessionId !== 'string' || !UUID.test(view.sessionId))) throw new Error('Invalid persisted worktree spike state');
  if (view.interactionStatus !== undefined && !INTERACTION_STATUSES.has(view.interactionStatus as WorktreeInteractionStatus)) throw new Error('Invalid persisted worktree spike state');
  if (view.transcript !== undefined && (!Array.isArray(view.transcript) || !view.transcript.every((entry, index, all) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return Number.isSafeInteger(item.sequence) && Number(item.sequence) > 0 && (index === 0 || Number(item.sequence) > Number((all[index - 1] as Record<string, unknown>).sequence))
      && TRANSCRIPT_ROLES.has(item.role as WorktreeTranscriptEntry['role']) && typeof item.text === 'string' && !!item.text.trim() && typeof item.createdAt === 'string';
  }))) throw new Error('Invalid persisted worktree spike state');
  return { ...(value as WorktreeSpikeView), documents: documents as WorktreeDocumentSummary[], interactionStatus: (view.interactionStatus as WorktreeInteractionStatus | undefined) ?? 'idle', transcript: (view.transcript as WorktreeTranscriptEntry[] | undefined) ?? [] };
}

export class SQLiteWorktreeSpikePersistence implements WorktreeSpikePersistencePort {
  constructor(private readonly db: Database.Database) {}

  load(srId: string): WorktreeSpikeView | undefined {
    const row = this.db.prepare('SELECT payload FROM worktree_spike_states WHERE sr_id=?').get(srId) as { payload: string } | undefined;
    if (!row) return undefined;
    const view = parse(row.payload);
    if (view.srId !== srId) throw new Error('Persisted worktree spike SR does not match its owner');
    return view;
  }

  save(view: WorktreeSpikeView): void {
    this.db.prepare(`INSERT INTO worktree_spike_states (sr_id,updated_at,payload) VALUES (?,?,?)
      ON CONFLICT(sr_id) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload`)
      .run(view.srId, new Date().toISOString(), JSON.stringify(view));
  }
}
