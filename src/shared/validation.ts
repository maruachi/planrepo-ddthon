import { LIMITS } from './limits.js';
import { fail } from './errors.js';
export function text(value: unknown, field: string, max: number = LIMITS.text, required = false, trim = false): string {
  if (typeof value !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('VALIDATION_ERROR', '유효한 텍스트를 입력해 주세요.', { field });
  const normalized = trim ? value.trim() : value;
  if (required && !normalized.trim()) fail('VALIDATION_ERROR', '필수 입력입니다.', { field });
  if (new TextEncoder().encode(normalized).byteLength > max) fail('PAYLOAD_TOO_LARGE', `최대 ${max.toLocaleString()}바이트까지 입력할 수 있습니다.`, { field });
  return normalized;
}
export function id(value: unknown, field = 'id'): string { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail('VALIDATION_ERROR', '올바른 식별자가 필요합니다.', { field }); return value; }
export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VALIDATION_ERROR', 'JSON 객체가 필요합니다.');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('VALIDATION_ERROR', '지원하지 않는 입력 필드입니다.');
  return value as Record<string, unknown>;
}
