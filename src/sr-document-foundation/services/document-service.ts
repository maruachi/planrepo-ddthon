import { randomUUID } from 'node:crypto';
import type { ActorContext, CommandContext, DocumentView, GeneratedArtifact, MutationResult, PageOptions, Result, VersionRef } from '../../shared/contracts.js';
import { errorOf, fail, result, unwrap } from '../../shared/errors.js';
import { LIMITS } from '../../shared/limits.js';
import { id, text } from '../../shared/validation.js';
import type { DiffPort, DiffView } from '../compare/diff-contracts.js';
import { emptyChanges, type ChangeSet, type StorePort } from '../storage/store-port.js';
export class DocumentService {
  constructor(private store: StorePort, private diff: DiffPort) {}
  listDocuments(srId: string, options?: PageOptions) { return this.store.read({ kind: 'documents', srId, options }); }
  readVersion(target: VersionRef) { return this.store.read({ kind: 'version', target }); }
  listVersions(srId: string, documentId: string, options?: PageOptions) { return this.store.read({ kind: 'versions', srId, documentId, options }); }
  listHistory(srId: string, documentId?: string, options?: PageOptions) { return this.store.read({ kind: 'history', srId, documentId, options }); }
  private saved(c: ChangeSet): MutationResult {
    const receipt = unwrap(this.store.commit(c)); if (!receipt?.ref) fail('STORAGE_FAILED', '저장 결과 참조가 없습니다.');
    return { view: unwrap(this.readVersion(receipt.ref)), changed: receipt.changed };
  }
  private versionChange(current: DocumentView, title: string, body: string, actor: ActorContext, origin: 'human_edit' | 'restoration', source?: DocumentView): ChangeSet {
    const c = emptyChanges(); const now = new Date().toISOString(); const ref = { srId: current.srId, documentId: current.documentId, versionId: randomUUID() };
    c.requireSrs.push(current.srId); c.expected.push({ srId: current.srId, documentId: current.documentId, versionId: current.versionId });
    c.versions.push({ ...ref, title, body, origin, actor, createdAt: now, baseVersionId: current.versionId, ...(source ? { sourceVersionId: source.versionId } : {}) }); c.pointers.push(ref);
    const refs: VersionRef[] = [ref, c.expected[0], ...(source ? [{ srId: source.srId, documentId: source.documentId, versionId: source.versionId }] : [])];
    c.events.push({ id: randomUUID(), srId: current.srId, kind: origin === 'human_edit' ? 'document_edited' : 'document_restored', actor, occurredAt: now, summary: origin === 'human_edit' ? '문서를 편집했습니다.' : '과거 내용을 새 버전으로 복원했습니다.', versionRefs: refs });
    c.outcome = { kind: origin === 'human_edit' ? 'edit' : 'restore', srId: ref.srId, ref, changed: true }; return c;
  }
  edit(target: VersionRef, body: string, actor: ActorContext, command?: CommandContext): Result<MutationResult> { return result(() => {
    text(body, 'body'); const current = unwrap(this.readVersion(target));
    if (!current.isLatest) fail('VERSION_CONFLICT', '편집 기준보다 새 버전이 있습니다. 초안을 유지하고 최신 내용을 확인해 주세요.', { currentVersionRef: current.latestVersionRef });
    const c = current.body === body ? emptyChanges() : this.versionChange(current, current.title, body, actor, 'human_edit');
    if (current.body === body) { c.expected.push(target); c.outcome = { kind: 'edit', srId: target.srId, ref: target, changed: false }; }
    c.command = command; return this.saved(c);
  }, 'STORAGE_FAILED'); }
  restore(source: VersionRef, actor: ActorContext, command?: CommandContext): Result<MutationResult> { return result(() => {
    const old = unwrap(this.readVersion(source)); const current = unwrap(this.readVersion(old.latestVersionRef));
    const c = this.versionChange(current, old.title, old.body, actor, 'restoration', old); c.command = command; return this.saved(c);
  }, 'STORAGE_FAILED'); }
  async compare(left: VersionRef, right: VersionRef, signal?: AbortSignal): Promise<Result<DiffView>> {
    try {
      if (left.srId !== right.srId || left.documentId !== right.documentId) fail('REFERENCE_MISMATCH', '같은 문서의 두 버전을 선택해 주세요.');
      const l = unwrap(this.readVersion(left)); const r = unwrap(this.readVersion(right)); const content = await this.diff.compare({ left: l, right: r }, signal);
      return { ok: true, data: { ...content, left: { ...left, title: l.title, versionNumber: l.versionNumber }, right: { ...right, title: r.title, versionNumber: r.versionNumber } } };
    } catch (e) { return { ok: false, error: errorOf(e, 'COMPARE_FAILED') }; }
  }
  prepareGenerated(srId: string, runId: string, artifacts: GeneratedArtifact[]): Result<ChangeSet> { return result(() => {
    unwrap(this.store.read({ kind: 'sr', srId })); id(runId, 'runId');
    if (!Array.isArray(artifacts)) fail('INVALID_GENERATED_ARTIFACT', '문서 배열이 필요합니다.');
    const c = emptyChanges(); c.requireSrs.push(srId); const keys = new Set<string>(); const ids = new Set<string>();
    for (const artifact of artifacts) {
      let key: string, title: string, body: string;
      try { key = text(artifact.logicalKey, 'logicalKey', LIMITS.title, true, true); title = text(artifact.title, 'title', LIMITS.title, true, true); body = text(artifact.body, 'body', LIMITS.text, true); }
      catch { return fail('INVALID_GENERATED_ARTIFACT', '생성 문서의 키·제목·본문이 올바르지 않습니다.'); }
      if (keys.has(key) || (artifact.documentId && ids.has(artifact.documentId))) fail('INVALID_GENERATED_ARTIFACT', '생성 결과에 중복 문서가 있습니다.');
      keys.add(key); if (artifact.documentId) ids.add(artifact.documentId);
      const existing = artifact.documentId ? unwrap(this.store.read({ kind: 'document', srId, documentId: artifact.documentId })) : null;
      if (existing && existing.logicalKey !== key) fail('INVALID_GENERATED_ARTIFACT', '문서 키가 일치하지 않습니다.');
      if (!existing && unwrap(this.store.read({ kind: 'documentKey', srId, logicalKey: key }))) fail('INVALID_GENERATED_ARTIFACT', '이미 사용 중인 문서 키입니다.');
      const now = new Date().toISOString(); const documentId = existing?.id ?? randomUUID(); const ref = { srId, documentId, versionId: randomUUID() };
      if (!existing) c.documents.push({ id: documentId, srId, logicalKey: key, latestVersionId: ref.versionId, createdAt: now });
      else c.expected.push({ srId, documentId, versionId: existing.latestVersionId });
      c.versions.push({ ...ref, title, body, origin: 'ai_generated', actor: { source: 'ai' }, createdAt: now, runId, ...(existing ? { baseVersionId: existing.latestVersionId } : {}) }); c.pointers.push(ref);
      c.events.push({ id: randomUUID(), srId, kind: 'document_generated', actor: { source: 'ai' }, occurredAt: now, summary: '계획 문서를 생성했습니다.', subject: { runId }, versionRefs: [ref] });
    } return c;
  }); }
}
