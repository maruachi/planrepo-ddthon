import type { Column } from './limits.js';
export interface VersionRef { srId: string; documentId: string; versionId: string }
export interface ActorContext { source: 'user' | 'ai' | 'system'; role?: 'author' | 'reviewer' }
export const AUTHOR: ActorContext = { source: 'user', role: 'author' };
export interface SRDraft { title: string; description: string; attachmentMarkdown?: string; attachmentDisplayName?: string }
export interface SR extends SRDraft { id: string; createdAt: string; actor: ActorContext; column: Column }
export type SRSummary = Pick<SR, 'id' | 'title' | 'createdAt' | 'column'> & { inceptionCycle?: number; constructionCycle?: number; planningStatus?: string; pendingReviews?: number };
export interface DocumentRecord { id: string; srId: string; logicalKey: string; latestVersionId: string; createdAt: string }
export type Origin = 'ai_generated' | 'human_edit' | 'restoration';
export interface VersionSummary extends VersionRef { versionNumber: number; title: string; origin: Origin; createdAt: string; actor: ActorContext; baseVersionId?: string; sourceVersionId?: string; runId?: string; isLatest: boolean }
export interface DocumentSummary extends VersionSummary { logicalKey: string; latestVersionRef: VersionRef }
export interface DocumentView extends VersionSummary { body: string; latestVersionRef: VersionRef }
export interface HistoryEvent { id: string; srId: string; sequence: number; kind: string; actor: ActorContext; occurredAt: string; summary: string; versionRefs: VersionRef[]; subject?: unknown; details?: unknown }
export interface PageOptions { limit?: number; cursor?: string }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface AppError { code: string; message: string; field?: string; target?: string; currentVersionRef?: VersionRef; operationId?: string }
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };
export type CommandKind = 'create' | 'edit' | 'restore' | 'move_board' | 'planning_advance' | 'planning_answer' | 'planning_decide' | 'planning_complete' | 'review_request' | 'review_result' | 'mark_implemented' | 'worktree_review_request' | 'worktree_review_result';
export interface CommandContext { operationId: string; kind: CommandKind; fingerprint: string }
export interface CommandReceipt { operationId?: string; kind: CommandKind; srId: string; ref?: VersionRef; runId?: string; reviewId?: string; changed: boolean; committedAt: string }
export interface MutationResult { view: DocumentView; changed: boolean }
export type OperationStatus = { status: 'committed'; receipt: CommandReceipt } | { status: 'in_progress' | 'unknown' };
export interface GeneratedArtifact { logicalKey: string; documentId?: string; title: string; body: string }
export type LocalCommand =
  | { kind: 'create'; input: SRDraft }
  | { kind: 'edit'; target: VersionRef; body: string }
  | { kind: 'restore'; source: VersionRef }
  | { kind: 'move_board'; srId: string; expectedColumn: Column; targetColumn: Column };
export type LocalQuery =
  | { kind: 'board'; options?: PageOptions }
  | { kind: 'boardItem'; srId: string }
  | { kind: 'sr'; srId: string }
  | { kind: 'documents'; srId: string; options?: PageOptions }
  | { kind: 'versions'; srId: string; documentId: string; options?: PageOptions }
  | { kind: 'version'; target: VersionRef }
  | { kind: 'history'; srId: string; documentId?: string; options?: PageOptions }
  | { kind: 'event'; srId: string; eventId: string }
  | { kind: 'compare'; left: VersionRef; right: VersionRef; signal?: AbortSignal }
  | { kind: 'operation'; operationId: string } | { kind: 'config' };
