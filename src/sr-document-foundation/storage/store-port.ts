import type { SR, SRSummary, VersionRef, DocumentRecord, DocumentView, DocumentSummary, VersionSummary, HistoryEvent, CommandContext, CommandReceipt, Page, PageOptions, Result } from '../../shared/contracts.js';
import type { PlanningRun, WorkflowState } from '../../shared/planning-contracts.js';
import type { ReviewRecord } from '../../shared/review-contracts.js';
export type NewVersion = Omit<DocumentView, 'versionNumber' | 'isLatest' | 'latestVersionRef'>;
export type NewEvent = Omit<HistoryEvent, 'sequence'>;
export interface ChangeSet {
  review?: { expectedStatus: null | 'requested'; review: ReviewRecord };
  planning?: { expectedRevision: number | null; state: WorkflowState; run?: PlanningRun };
  expectedDocumentSet?: { srId: string; refs: VersionRef[] };
  sr?: SR;
  requireSrs: string[];
  expected: { srId: string; documentId: string; versionId: string }[];
  documents: DocumentRecord[];
  versions: NewVersion[];
  pointers: VersionRef[];
  events: NewEvent[];
  command?: CommandContext;
  outcome?: Omit<CommandReceipt, 'operationId' | 'committedAt'>;
}
export function emptyChanges(): ChangeSet { return { requireSrs: [], expected: [], documents: [], versions: [], pointers: [], events: [] }; }
export type ReadQuery =
  | { kind: 'reviews'; srId: string; options?: PageOptions }
  | { kind: 'review'; srId: string; reviewId: string }
  | { kind: 'workflow'; srId: string }
  | { kind: 'run'; srId: string; runId: string }
  | { kind: 'runningRuns' }
  | { kind: 'board'; options?: PageOptions }
  | { kind: 'sr'; srId: string }
  | { kind: 'document'; srId: string; documentId: string }
  | { kind: 'documentKey'; srId: string; logicalKey: string }
  | { kind: 'documents'; srId: string; options?: PageOptions }
  | { kind: 'version'; target: VersionRef }
  | { kind: 'versions'; srId: string; documentId: string; options?: PageOptions }
  | { kind: 'history'; srId: string; documentId?: string; options?: PageOptions }
  | { kind: 'event'; srId: string; eventId: string }
  | { kind: 'receipt'; operationId: string };
export interface ReadResults { reviews: Page<ReviewRecord>; review: ReviewRecord; workflow: WorkflowState | null; run: PlanningRun; runningRuns: PlanningRun[]; board: Page<SRSummary>; sr: SR; document: DocumentRecord; documentKey: DocumentRecord | null; documents: Page<DocumentSummary>; version: DocumentView; versions: Page<VersionSummary>; history: Page<HistoryEvent>; event: HistoryEvent; receipt: (CommandReceipt & { fingerprint: string }) | null }
export interface StorePort {
  read<Q extends ReadQuery>(query: Q): Result<ReadResults[Q['kind']]>;
  commit(changes: ChangeSet): Result<CommandReceipt | null>;
}
