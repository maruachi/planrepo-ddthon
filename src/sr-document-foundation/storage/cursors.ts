import { fail } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import type { Page, PageOptions } from '../../shared/contracts.js';
type Key = string | number;
export function paging(scope: string, options: PageOptions = {}): { limit: number; key: Key[] | null } {
  const limit = options.limit ?? LIMITS.page;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMITS.maxPage) fail('VALIDATION_ERROR', '목록 크기는 1–100이어야 합니다.');
  if (!options.cursor) return { limit, key: null };
  try {
    if (Buffer.byteLength(options.cursor) > LIMITS.cursor || !/^[A-Za-z0-9_-]+$/.test(options.cursor)) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
    const value = parsed as { scope: string; key: Key[] };
    if (!value || value.scope !== scope || !Array.isArray(value.key) || !value.key.length || value.key.length > 2 || value.key.some(k => typeof k !== 'string' && !(Number.isSafeInteger(k) && Number(k) > 0))) throw new Error();
    return { limit, key: value.key };
  } catch { return fail('VALIDATION_ERROR', '현재 목록에 맞는 커서가 아닙니다.'); }
}
export function page<T>(rows: T[], limit: number, scope: string, key: (row: T) => Key[]): Page<T> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ scope, key: key(items[items.length - 1]) })).toString('base64url') : null };
}
export function cursorKey(key: Key[] | null, types: ('string' | 'number')[]): void {
  if (key && types.length === 2 && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(key[0])) || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(key[1])))) fail('VALIDATION_ERROR', '커서의 시각 또는 식별자가 올바르지 않습니다.');
  if (key && (key.length !== types.length || key.some((v, i) => typeof v !== types[i]))) fail('VALIDATION_ERROR', '커서 정렬 값이 올바르지 않습니다.');
}
