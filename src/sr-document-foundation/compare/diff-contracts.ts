import type { DocumentView, VersionRef } from '../../shared/contracts.js';
export interface DiffBlock { kind: 'equal' | 'add' | 'remove'; text: string; count: number }
export interface DiffContent { mode: 'detailed' | 'coarse'; reason?: string; blocks: DiffBlock[]; unchanged: boolean; titleChanged: boolean }
export interface DiffView extends DiffContent { left: VersionRef & { title: string; versionNumber: number }; right: VersionRef & { title: string; versionNumber: number } }
export interface DiffInput { left: Pick<DocumentView, 'body' | 'title'>; right: Pick<DocumentView, 'body' | 'title'> }
export interface DiffPort { compare(input: DiffInput, signal?: AbortSignal): Promise<DiffContent>; close(): Promise<void> }
