import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { fail } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import type { WorktreeDocumentSummary, WorktreeDocumentView } from '../contracts.js';
import { isManagedManifestPath } from '../manifest/scoped-manifest.js';

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

const READ_ONLY_DOCUMENTS = new Set(['aidlc-docs/aidlc-state.md', 'aidlc-docs/audit.md']);

export function validateWorktreeDocumentPath(path: string): string {
  if (!path.startsWith('aidlc-docs/') || posix.normalize(path) !== path || !isManagedManifestPath(path)) fail('VALIDATION_ERROR', '조회할 수 없는 Worktree 문서 경로입니다.');
  return path;
}

export function isEditableWorktreeDocumentPath(path: string): boolean {
  return path.startsWith('aidlc-docs/') && isManagedManifestPath(path) && !READ_ONLY_DOCUMENTS.has(path);
}

export function requireEditableWorktreeDocumentPath(path: string): string {
  validateWorktreeDocumentPath(path);
  if (!isEditableWorktreeDocumentPath(path)) fail('WORKTREE_DOCUMENT_READ_ONLY', '상태와 감사 문서는 편집할 수 없습니다.');
  return path;
}

export async function readWorktreeDocument(worktreeRoot: string, summary: WorktreeDocumentSummary): Promise<WorktreeDocumentView> {
  validateWorktreeDocumentPath(summary.path);
  const root = await realpath(resolve(worktreeRoot));
  const requested = resolve(root, summary.path);
  if (!contained(root, requested)) fail('VALIDATION_ERROR', 'Worktree 밖의 문서는 조회할 수 없습니다.');
  let details;
  try { details = await lstat(requested); }
  catch (error) { if ((error as { code?: string })?.code === 'ENOENT') fail('NOT_FOUND', 'Worktree 문서를 찾을 수 없습니다.'); throw error; }
  if (details.isSymbolicLink() || !details.isFile()) fail('VALIDATION_ERROR', '일반 Markdown 파일만 조회할 수 있습니다.');
  const canonical = await realpath(requested);
  if (!contained(root, canonical)) fail('VALIDATION_ERROR', 'Worktree 밖의 문서는 조회할 수 없습니다.');
  const bytes = await readFile(canonical);
  if (bytes.byteLength > LIMITS.text) fail('PAYLOAD_TOO_LARGE', 'Worktree 문서는 최대 1 MiB까지 조회할 수 있습니다.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== summary.hash) fail('VERSION_CONFLICT', '기록 이후 Worktree 문서가 다시 변경되었습니다. AI-DLC 실행을 다시 수행해 목록을 갱신해 주세요.');
  let body: string;
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('VALIDATION_ERROR', 'UTF-8 Markdown 문서만 조회할 수 있습니다.'); }
  return { ...summary, body, isLatest: true };
}
