import type { AppError, DocumentView, HistoryEvent, MutationResult, OperationStatus, Page, SR, VersionRef } from '../contracts.js';
import { DomainError } from '../errors.js';
export type Guard<T> = (value: unknown) => value is T;
export const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export const isRef: Guard<VersionRef> = (x): x is VersionRef => record(x) && ['srId', 'documentId', 'versionId'].every(k => typeof x[k] === 'string');
export const isSR: Guard<SR> = (x): x is SR => record(x) && ['id', 'title', 'description', 'createdAt', 'column'].every(k => typeof x[k] === 'string');
export const isDocument: Guard<DocumentView> = (x): x is DocumentView => isRef(x) && record(x) && typeof x.body === 'string' && typeof x.title === 'string' && Number.isSafeInteger(x.versionNumber) && typeof x.isLatest === 'boolean' && isRef(x.latestVersionRef);
export const isMutation: Guard<MutationResult> = (x): x is MutationResult => record(x) && typeof x.changed === 'boolean' && isDocument(x.view);
export const isEvent: Guard<HistoryEvent> = (x): x is HistoryEvent => record(x) && typeof x.id === 'string' && typeof x.summary === 'string' && Array.isArray(x.versionRefs) && x.versionRefs.every(isRef);
export function isPage<T>(guard: Guard<T>): Guard<Page<T>> { return (x): x is Page<T> => record(x) && Array.isArray(x.items) && x.items.every(guard) && (x.nextCursor === null || typeof x.nextCursor === 'string'); }
export const isOperation: Guard<OperationStatus> = (x): x is OperationStatus => record(x) && (x.status === 'unknown' || x.status === 'in_progress' || (x.status === 'committed' && record(x.receipt) && typeof x.receipt.srId === 'string' && typeof x.receipt.changed === 'boolean' && ['create', 'edit', 'restore'].includes(String(x.receipt.kind)) && (x.receipt.kind === 'create' || isRef(x.receipt.ref))));
export class ApiClient {
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async request<T>(path: string, guard: Guard<T>, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(path, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal, cache: 'no-store' });
      const value: unknown = await response.json();
      if (!record(value) || typeof value.ok !== 'boolean') throw new Error('Malformed response');
      if (!value.ok) {
        if (!record(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string' || response.ok) throw new Error('Malformed error');
        throw new DomainError(value.error as unknown as AppError);
      }
      if (!response.ok || !guard(value.data)) throw new Error('Malformed success');
      return value.data;
    } finally { clearTimeout(timeout); }
  }
}
export const api = new ApiClient();
export const versionURL = (r: VersionRef) => `/api/srs/${r.srId}/documents/${r.documentId}/versions/${r.versionId}`;
export const versionRoute = (r: VersionRef) => `/srs/${r.srId}/documents/${r.documentId}/versions/${r.versionId}`;
