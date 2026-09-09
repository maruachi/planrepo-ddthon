import { LIMITS } from '../../shared/limits.js';
import { fail } from '../../shared/errors.js';
export async function readAttachment(file: File): Promise<string> {
  if (file.size > LIMITS.text) fail('PAYLOAD_TOO_LARGE', '첨부는 최대 1 MiB까지 가능합니다.', { field: 'attachmentMarkdown' });
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch { return fail('VALIDATION_ERROR', 'UTF-8 마크다운 파일을 읽지 못했습니다.', { field: 'attachmentMarkdown' }); }
}
