import type { VersionRef } from './contracts.js';
export type DemoRole = 'author' | 'reviewer';
export interface ReviewRecord {
  id: string; srId: string; target: VersionRef; requestComment: string; requestedAt: string;
  status: 'requested' | 'approved' | 'changes_requested'; resultComment?: string; decidedAt?: string;
}
export interface ReviewView extends ReviewRecord { isLatest: boolean; latestVersionRef: VersionRef; documentTitle: string; versionNumber: number }
export interface ReviewDraft { target: VersionRef; comment: string }
export interface ReviewResultInput { kind: 'approve' | 'request_changes'; comment: string }
