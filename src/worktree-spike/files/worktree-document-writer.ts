import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fail } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import { text } from '../../shared/validation.js';
import type { WorktreeDocumentEditRequest, WorktreeDocumentWriteResult, WorktreeDocumentWriterPort } from '../contracts.js';
import { requireEditableWorktreeDocumentPath } from './worktree-document-reader.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function utf8(body: string): Uint8Array {
  const bytes = new TextEncoder().encode(text(body, 'body'));
  if (bytes.byteLength > LIMITS.text) fail('PAYLOAD_TOO_LARGE', 'Worktree 문서는 최대 1 MiB까지 저장할 수 있습니다.');
  return bytes;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try { await handle.sync(); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
  } finally { await handle.close(); }
}

async function atomicReplace(target: string, bytes: Uint8Array, mode: number): Promise<void> {
  const temporary = `${target}.planrepo-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', mode & 0o777);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, mode & 0o777);
    await rename(temporary, target);
    await syncDirectory(dirname(target));
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function resolveTarget(worktreeRoot: string, path: string): Promise<{ target: string; mode: number }> {
  requireEditableWorktreeDocumentPath(path);
  const root = await realpath(resolve(worktreeRoot));
  const requested = resolve(root, path);
  if (!contained(root, requested)) fail('VALIDATION_ERROR', 'Worktree 밖의 문서는 저장할 수 없습니다.');
  let details;
  try { details = await lstat(requested); }
  catch (error) { if ((error as { code?: string })?.code === 'ENOENT') fail('NOT_FOUND', 'Worktree 문서를 찾을 수 없습니다.'); throw error; }
  if (details.isSymbolicLink() || !details.isFile()) fail('VALIDATION_ERROR', '일반 Markdown 파일만 저장할 수 있습니다.');
  const target = await realpath(requested);
  if (!contained(root, target)) fail('VALIDATION_ERROR', 'Worktree 밖의 문서는 저장할 수 없습니다.');
  return { target, mode: details.mode };
}

export class WorktreeDocumentWriter implements WorktreeDocumentWriterPort {
  async write(worktreeRoot: string, request: WorktreeDocumentEditRequest): Promise<WorktreeDocumentWriteResult> {
    if (!SHA256.test(request.expectedHash)) fail('VALIDATION_ERROR', '올바른 문서 SHA-256이 필요합니다.');
    const body = utf8(request.body);
    const { target, mode } = await resolveTarget(worktreeRoot, request.path);
    const original = await readFile(target);
    if (original.byteLength > LIMITS.text) fail('PAYLOAD_TOO_LARGE', 'Worktree 문서는 최대 1 MiB까지 저장할 수 있습니다.');
    try { new TextDecoder('utf-8', { fatal: true }).decode(original); }
    catch { fail('VALIDATION_ERROR', 'UTF-8 Markdown 문서만 저장할 수 있습니다.'); }
    const currentHash = digest(original);
    if (currentHash !== request.expectedHash) fail('VERSION_CONFLICT', 'Worktree 문서가 변경되었습니다. 초안을 유지하고 다시 확인해 주세요.');
    const hash = digest(body);
    if (hash === currentHash) return { changed: false, hash, body: request.body };
    await atomicReplace(target, body, mode);
    return { changed: true, hash, body: request.body, rollback: { body: new Uint8Array(original), mode } };
  }

  async restore(worktreeRoot: string, path: string, expectedHash: string, rollback: { body: Uint8Array; mode: number }): Promise<void> {
    const { target } = await resolveTarget(worktreeRoot, path);
    const current = await readFile(target);
    if (digest(current) !== expectedHash) fail('STORAGE_FAILED', '저장 실패 후 원본을 안전하게 복구하지 못했습니다.');
    await atomicReplace(target, rollback.body, rollback.mode);
  }
}
