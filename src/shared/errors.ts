import type { AppError, Result } from './contracts.js';
export class DomainError extends Error {
  constructor(public detail: AppError) { super(detail.message); }
}
export function fail(code: string, message: string, extra: Omit<AppError, 'code' | 'message'> = {}): never { throw new DomainError({ code, message, ...extra }); }
export function errorOf(error: unknown, fallback = 'READ_FAILED'): AppError {
  if (error instanceof DomainError) return error.detail;
  const code = (error as { code?: string })?.code;
  return { code: code === 'SQLITE_BUSY' ? 'STORAGE_BUSY' : fallback, message: code === 'SQLITE_BUSY' ? '저장소가 사용 중입니다. 잠시 후 다시 시도해 주세요.' : '처리를 완료하지 못했습니다. 입력을 유지하고 다시 확인해 주세요.' };
}
export function result<T>(fn: () => T, fallback?: string): Result<T> { try { return { ok: true, data: fn() }; } catch (e) { return { ok: false, error: errorOf(e, fallback) }; } }
export function unwrap<T>(value: Result<T>): T { if (!value.ok) throw new DomainError(value.error); return value.data; }
