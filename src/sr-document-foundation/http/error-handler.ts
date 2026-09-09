import type { ErrorRequestHandler, Response } from 'express';
import type { Result } from '../../shared/contracts.js';
import { errorOf } from '../../shared/errors.js';
export const statusFor = (code: string): number => ({ VALIDATION_ERROR: 400, REFERENCE_MISMATCH: 400, ROLE_REQUIRED: 403, NOT_FOUND: 404, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, REVIEW_CONFLICT: 409, REVIEW_ACTION_BLOCKED: 409, VERSION_CONFLICT: 409, OPERATION_CONFLICT: 409, WORKFLOW_CONFLICT: 409, PLANNING_ACTION_BLOCKED: 409, APPROVAL_REQUIRED: 409, IN_PROGRESS: 409, STORAGE_BUSY: 503, COMPARE_BUSY: 503, OUTCOME_UNKNOWN: 503 }[code] ?? 500);
export function sendResult(res: Response, value: Result<unknown>, success = 200): void { res.status(value.ok ? success : statusFor(value.error.code)).json(value); }
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const parser = error as { type?: string; status?: number };
  const detail = parser.type === 'entity.too.large' ? { code: 'PAYLOAD_TOO_LARGE', message: 'JSON 요청 크기를 초과했습니다.' } : parser.type === 'encoding.unsupported' || parser.type === 'charset.unsupported' ? { code: 'UNSUPPORTED_MEDIA_TYPE', message: '지원하지 않는 전송 형식입니다.' } : parser.type === 'entity.parse.failed' ? { code: 'VALIDATION_ERROR', message: '올바른 JSON이 필요합니다.' } : errorOf(error);
  console.error(JSON.stringify({ time: new Date().toISOString(), code: detail.code }));
  sendResult(res, { ok: false, error: detail });
};
