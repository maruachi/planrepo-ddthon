import type { PageOptions, SRDraft } from '../../shared/contracts.js';
import { fail, unwrap } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import { object, text } from '../../shared/validation.js';
import { DirectSRInput } from '../services/sr-input.js';
export function pageOptions(query: unknown, extra: string[] = []): PageOptions {
  const q = object(query, ['limit', 'cursor', ...extra]); const options: PageOptions = {};
  if (q.limit !== undefined) { if (typeof q.limit !== 'string' || !/^[1-9]\d*$/.test(q.limit)) fail('VALIDATION_ERROR', '올바른 목록 크기가 필요합니다.'); options.limit = Number(q.limit); if (options.limit > LIMITS.maxPage) fail('VALIDATION_ERROR', '최대 100개까지 조회할 수 있습니다.'); }
  if (q.cursor !== undefined) options.cursor = text(q.cursor, 'cursor', LIMITS.cursor, true);
  return options;
}
export function srDraft(value: unknown): SRDraft {
  const q = object(value, ['title', 'description', 'attachmentMarkdown', 'attachmentDisplayName']);
  const draft = { title: q.title, description: q.description, ...(q.attachmentMarkdown !== undefined ? { attachmentMarkdown: q.attachmentMarkdown } : {}), ...(q.attachmentDisplayName !== undefined ? { attachmentDisplayName: q.attachmentDisplayName } : {}) } as SRDraft;
  unwrap(new DirectSRInput().normalize(draft)); return draft;
}
