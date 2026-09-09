import { createHash, randomUUID } from 'node:crypto';
import { fail } from '../shared/errors.js';
import {
  RESUME_PROMPT,
  buildInitialWorkflowPrompt,
  type AidlcStateParserPort,
  type GitWorktreePort,
  type ManifestPort,
  type WorktreeAidlcRunnerPort,
  type WorktreeDocumentEditRequest,
  type WorktreeDocumentEditResult,
  type WorktreeDocumentHistoryPort,
  type WorktreeDocumentView,
  type WorktreeDocumentWriterPort,
  type WorktreeHandle,
  type WorktreeRunHandle,
  type WorktreeSrRequirementsPort,
  type WorktreeStreamEvent,
  type WorktreeSpikePersistencePort,
  type WorktreeSpikeView,
} from './contracts.js';
import { readWorktreeDocument } from './files/worktree-document-reader.js';
import { isEditableWorktreeDocumentPath } from './files/worktree-document-reader.js';
import { appendTranscript } from './runner/claude-stream-protocol.js';

interface SpikeDependencies {
  repositoryRoot?: string;
  workspaceRoot: string;
  git: GitWorktreePort;
  state: AidlcStateParserPort;
  manifest: ManifestPort;
  runner: WorktreeAidlcRunnerPort;
  requirements?: WorktreeSrRequirementsPort;
  persistence?: WorktreeSpikePersistencePort;
  history?: WorktreeDocumentHistoryPort;
  writer?: WorktreeDocumentWriterPort;
}

interface Operation {
  key: string;
  promise: Promise<WorktreeSpikeView>;
}

interface ActiveInteraction {
  handle: WorktreeRunHandle;
  worktree: WorktreeHandle;
  before: Awaited<ReturnType<ManifestPort['capture']>>;
  operationId: string;
  cancelled: boolean;
}

const initialView = (srId: string, configured: boolean): WorktreeSpikeView => ({
  srId,
  configured,
  readiness: 'absent',
  runStatus: 'idle',
  interactionStatus: 'idle',
  transcript: [],
  changedPaths: [],
  documents: [],
});

export class WorktreeSpikeService {
  private readonly views = new Map<string, WorktreeSpikeView>();
  private readonly handles = new Map<string, WorktreeHandle>();
  private readonly operations = new Map<string, Operation>();
  private readonly editOperations = new Map<string, { key: string; promise: Promise<WorktreeDocumentEditResult> }>();
  private readonly active = new Map<string, ActiveInteraction>();
  private readonly completions = new Set<Promise<void>>();

  constructor(private readonly dependencies: SpikeDependencies) {}

  get(srId: string): WorktreeSpikeView {
    return { ...this.current(srId), configured: !!this.dependencies.repositoryRoot };
  }

  async document(srId: string, path: string, versionId?: string): Promise<WorktreeDocumentView> {
    if (versionId) {
      if (!this.dependencies.history) fail('NOT_FOUND', 'Worktree 문서 이력을 찾을 수 없습니다.');
      return this.dependencies.history.readVersion(srId, path, versionId);
    }
    const view = this.current(srId);
    const summary = view.documents.find(document => document.path === path);
    if (!summary || !view.worktreeRoot) fail('NOT_FOUND', '실행에서 생성되거나 변경된 Worktree 문서가 아닙니다.');
    return readWorktreeDocument(view.worktreeRoot, summary);
  }

  versions(srId: string, path: string) {
    if (!this.dependencies.history) fail('NOT_FOUND', 'Worktree 문서 이력을 찾을 수 없습니다.');
    return this.dependencies.history.listVersions(srId, path);
  }

  edit(srId: string, operationId: string, request: WorktreeDocumentEditRequest): Promise<WorktreeDocumentEditResult> {
    const key = createHash('sha256').update(`${srId}\0${request.path}\0${request.expectedHash}\0${request.body}`).digest('hex');
    const existing = this.editOperations.get(operationId);
    if (existing) {
      if (existing.key !== key) fail('OPERATION_CONFLICT', '같은 작업 ID를 다른 요청에 사용할 수 없습니다.');
      return existing.promise;
    }
    const promise = this.performEdit(srId, operationId, key, request);
    this.editOperations.set(operationId, { key, promise });
    return promise;
  }

  provision(srId: string, operationId: string): Promise<WorktreeSpikeView> {
    return this.once(operationId, `provision:${srId}`, async () => {
      const repositoryRoot = this.dependencies.repositoryRoot;
      if (!repositoryRoot) fail('PLANNING_ACTION_BLOCKED', 'PLANREPO_REPOSITORY_PATH를 설정해 주세요.');
      const handle = await this.dependencies.git.provision(repositoryRoot, this.dependencies.workspaceRoot, srId);
      const parsed = await this.dependencies.state.parse(handle.worktreeRoot);
      const previous = this.current(srId);
      this.handles.set(srId, handle);
      const view: WorktreeSpikeView = {
        srId,
        configured: true,
        readiness: handle.readiness,
        branch: handle.branch,
        worktreeRoot: handle.worktreeRoot,
        currentStage: parsed.currentStage,
        firstIncomplete: parsed.firstIncomplete,
        runStatus: previous.runStatus,
        sessionId: previous.sessionId,
        interactionStatus: previous.interactionStatus ?? 'idle',
        transcript: previous.transcript ?? [],
        changedPaths: previous.changedPaths,
        documents: previous.documents,
      };
      this.save(view);
      return { ...view };
    });
  }

  resume(srId: string, operationId: string): Promise<WorktreeSpikeView> {
    return this.once(operationId, `resume:${srId}`, async () => {
      const worktree = await this.worktree(srId);
      if (this.active.has(srId)) return this.get(srId);
      const current = this.current(srId);
      const prompt = current.sessionId ? RESUME_PROMPT : buildInitialWorkflowPrompt(this.requirements(srId));
      return this.startInteraction(srId, operationId, prompt, worktree);
    });
  }

  message(srId: string, operationId: string, message: string): Promise<WorktreeSpikeView> {
    return this.once(operationId, `message:${srId}:${createHash('sha256').update(message).digest('hex')}`, async () => {
      const active = this.active.get(srId);
      if (!active) {
        const current = this.current(srId);
        if (!current.sessionId) fail('PLANNING_ACTION_BLOCKED', '먼저 AI-DLC 대화를 시작해 주세요.');
        return this.startInteraction(srId, operationId, message, await this.worktree(srId));
      }
      await active.handle.send(message);
      this.append(srId, 'user', message);
      const current = this.current(srId);
      this.save({ ...current, runStatus: 'running', interactionStatus: 'running', error: undefined });
      return this.get(srId);
    });
  }

  finish(srId: string, operationId: string): Promise<WorktreeSpikeView> {
    return this.once(operationId, `finish:${srId}`, async () => {
      const active = this.active.get(srId);
      if (!active) fail('PLANNING_ACTION_BLOCKED', '종료할 Claude 대화가 없습니다.');
      active.handle.finish();
      const current = this.current(srId);
      this.save({ ...current, interactionStatus: 'finishing' });
      return this.get(srId);
    });
  }

  cancel(srId: string, operationId: string): Promise<WorktreeSpikeView> {
    return this.once(operationId, `cancel:${srId}`, async () => {
      const active = this.active.get(srId);
      if (!active) fail('PLANNING_ACTION_BLOCKED', '취소할 Claude 대화가 없습니다.');
      active.cancelled = true;
      active.handle.cancel();
      const current = this.current(srId);
      this.save({ ...current, runStatus: 'failed', interactionStatus: 'cancelled', error: undefined });
      return this.get(srId);
    });
  }

  async close(): Promise<void> {
    await this.dependencies.runner.close();
    await Promise.allSettled([...this.completions]);
  }

  private current(srId: string): WorktreeSpikeView {
    const cached = this.views.get(srId);
    if (cached) return cached;
    const loaded = this.dependencies.persistence?.load(srId) ?? initialView(srId, !!this.dependencies.repositoryRoot);
    const stale = ['running', 'awaiting_input', 'finishing'].includes(loaded.interactionStatus ?? '') && !this.active.has(srId);
    const normalized = stale ? { ...loaded, runStatus: 'failed' as const, interactionStatus: 'failed' as const, error: '이전 서버 실행에서 Claude 대화가 중단되었습니다. 이어서 실행해 주세요.' } : loaded;
    this.views.set(srId, normalized);
    if (stale) this.dependencies.persistence?.save(normalized);
    return normalized;
  }

  private save(view: WorktreeSpikeView): void {
    this.dependencies.persistence?.save(view);
    this.views.set(view.srId, view);
  }

  private async worktree(srId: string): Promise<WorktreeHandle> {
    const existing = this.handles.get(srId);
    if (existing) return existing;
    const repositoryRoot = this.dependencies.repositoryRoot;
    if (!repositoryRoot || this.current(srId).readiness !== 'ready') fail('PLANNING_ACTION_BLOCKED', '먼저 SR worktree를 준비해 주세요.');
    const handle = await this.dependencies.git.provision(repositoryRoot, this.dependencies.workspaceRoot, srId);
    this.handles.set(srId, handle);
    return handle;
  }

  private requirements(srId: string) {
    if (!this.dependencies.requirements) fail('PLANNING_ACTION_BLOCKED', 'SR 요구사항 조회기가 준비되지 않았습니다.');
    return this.dependencies.requirements.get(srId);
  }

  private async startInteraction(srId: string, operationId: string, prompt: string, worktree: WorktreeHandle): Promise<WorktreeSpikeView> {
    const current = this.current(srId);
    const before = await this.dependencies.manifest.capture(worktree.worktreeRoot);
    if (!this.dependencies.runner.start) return this.runLegacy(srId, operationId, prompt, worktree, before, current);
    const sessionId = current.sessionId ?? randomUUID();
    this.save({ ...current, sessionId, runStatus: 'running', interactionStatus: 'running', transcript: current.transcript ?? [], error: undefined });
    this.append(srId, 'user', prompt);
    let handle: WorktreeRunHandle;
    try {
      handle = this.dependencies.runner.start({ srId, worktreeRoot: worktree.worktreeRoot, prompt, operationId, sessionId, resume: !!current.sessionId }, event => this.streamEvent(srId, sessionId, event));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Claude 대화를 시작하지 못했습니다.';
      this.save({ ...this.current(srId), runStatus: 'failed', interactionStatus: 'failed', error: message });
      throw error;
    }
    const active: ActiveInteraction = { handle, worktree, before, operationId, cancelled: false };
    this.active.set(srId, active);
    const completion = this.completeInteraction(srId, active);
    this.completions.add(completion);
    void completion.finally(() => this.completions.delete(completion));
    return this.get(srId);
  }

  private streamEvent(srId: string, sessionId: string, event: WorktreeStreamEvent): void {
    if (event.sessionId && event.sessionId !== sessionId) {
      this.append(srId, 'error', 'Claude session ID가 현재 SR과 일치하지 않습니다.');
      this.active.get(srId)?.handle.cancel();
      return;
    }
    this.append(srId, event.role, event.text);
    if (event.turnComplete) {
      const current = this.current(srId);
      this.save({ ...current, interactionStatus: 'awaiting_input' });
    }
  }

  private append(srId: string, role: WorktreeStreamEvent['role'], text: string): void {
    const current = this.current(srId);
    this.save({ ...current, transcript: appendTranscript(current.transcript ?? [], { role, text, createdAt: new Date().toISOString() }) });
  }

  private async completeInteraction(srId: string, active: ActiveInteraction): Promise<void> {
    try {
      const outcome = await active.handle.completion;
      if (outcome.exitCode !== 0) fail('CLI_FAILED', 'AI-DLC 재개 실행에 실패했습니다.');
      await this.collectRun(srId, active.operationId, active.worktree, active.before);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI-DLC 재개 실행에 실패했습니다.';
      const current = this.current(srId);
      this.save({ ...current, runStatus: 'failed', interactionStatus: active.cancelled ? 'cancelled' : 'failed', error: active.cancelled ? undefined : message });
    } finally {
      if (this.active.get(srId) === active) this.active.delete(srId);
    }
  }

  private async runLegacy(srId: string, operationId: string, prompt: string, worktree: WorktreeHandle, before: Awaited<ReturnType<ManifestPort['capture']>>, current: WorktreeSpikeView): Promise<WorktreeSpikeView> {
    this.save({ ...current, runStatus: 'running', error: undefined });
    try {
      const outcome = await this.dependencies.runner.run({ srId, worktreeRoot: worktree.worktreeRoot, prompt, operationId });
      if (outcome.exitCode !== 0) fail('CLI_FAILED', 'AI-DLC 재개 실행에 실패했습니다.');
      await this.collectRun(srId, operationId, worktree, before);
      return this.get(srId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI-DLC 재개 실행에 실패했습니다.';
      this.save({ ...current, runStatus: 'failed', error: message });
      throw error;
    }
  }

  private async collectRun(srId: string, operationId: string, worktree: WorktreeHandle, before: Awaited<ReturnType<ManifestPort['capture']>>): Promise<void> {
    const current = this.current(srId);
    const after = await this.dependencies.manifest.capture(worktree.worktreeRoot);
    const delta = this.dependencies.manifest.diff(before, after);
    const parsed = await this.dependencies.state.parse(worktree.worktreeRoot);
    const changedPaths = [...new Set([...delta.created, ...delta.modified, ...delta.deleted])].sort();
    const created = new Set(delta.created); const modified = new Set(delta.modified);
    const candidates = delta.after.entries.filter(entry => entry.path.startsWith('aidlc-docs/') && entry.path.endsWith('.md'));
    const collected = candidates.map(entry => {
      const prior = current.documents.find(document => document.path === entry.path);
      const change = created.has(entry.path) ? 'created' as const : modified.has(entry.path) ? 'modified' as const : 'unchanged' as const;
      const summary = prior ?? { srId, path: entry.path, hash: entry.hash, change, editable: isEditableWorktreeDocumentPath(entry.path), versionId: `pending:${entry.hash}`, versionNumber: 1, origin: 'ai_generated' as const, createdAt: new Date().toISOString() };
      return { entry, change, summary };
    });
    let documents;
    if (this.dependencies.history) {
      const snapshots = await Promise.all(collected.map(async item => ({ ...item, body: (await readWorktreeDocument(worktree.worktreeRoot, { ...item.summary, hash: item.entry.hash, change: item.change })).body })));
      for (const item of snapshots) this.dependencies.history.recordSnapshot({ srId, path: item.entry.path, hash: item.entry.hash, body: item.body, origin: 'ai_generated', change: item.change, sourceOperationId: operationId });
      const currentPaths = new Set(candidates.map(entry => entry.path));
      documents = this.dependencies.history.listDocuments(srId).filter(document => currentPaths.has(document.path));
    } else {
      documents = collected.map(({ entry, change }) => ({ srId, path: entry.path, hash: entry.hash, change, editable: isEditableWorktreeDocumentPath(entry.path), versionId: `legacy:${entry.hash}`, versionNumber: 1, origin: 'ai_generated' as const, createdAt: new Date().toISOString() }));
    }
    this.save({ ...current, currentStage: parsed.currentStage, firstIncomplete: parsed.firstIncomplete, runStatus: 'succeeded', interactionStatus: 'succeeded', changedPaths, documents, error: undefined });
  }

  private async performEdit(srId: string, operationId: string, fingerprint: string, request: WorktreeDocumentEditRequest): Promise<WorktreeDocumentEditResult> {
    const history = this.dependencies.history; const writer = this.dependencies.writer;
    if (!history || !writer) fail('PLANNING_ACTION_BLOCKED', 'Worktree 문서 편집 저장소가 준비되지 않았습니다.');
    const replay = history.editReceipt(operationId, fingerprint);
    if (replay) return replay;
    const current = this.current(srId);
    if (!current.worktreeRoot || !current.documents.some(document => document.path === request.path)) fail('NOT_FOUND', '현재 Worktree 문서를 찾을 수 없습니다.');
    const written = await writer.write(current.worktreeRoot, request);
    try {
      const result = history.recordHumanEdit({ srId, path: request.path, hash: written.hash, body: written.body, origin: 'human_edit', change: 'modified', sourceOperationId: operationId, operationId, fingerprint, expectedHash: request.expectedHash });
      const { body: _body, isLatest: _isLatest, ...summary } = result.view;
      this.save({ ...current, changedPaths: [...new Set([...current.changedPaths, request.path])].sort(), documents: current.documents.map(document => document.path === request.path ? summary : document) });
      return result;
    } catch (error) {
      if (written.changed && written.rollback) {
        try { await writer.restore(current.worktreeRoot, request.path, written.hash, written.rollback); }
        catch { fail('STORAGE_FAILED', '이력 저장 실패 후 Worktree 원본 복구에도 실패했습니다. 파일을 직접 확인해 주세요.'); }
      }
      throw error;
    }
  }

  private once(operationId: string, key: string, task: () => Promise<WorktreeSpikeView>): Promise<WorktreeSpikeView> {
    const existing = this.operations.get(operationId);
    if (existing) {
      if (existing.key !== key) fail('OPERATION_CONFLICT', '같은 작업 ID를 다른 요청에 사용할 수 없습니다.');
      return existing.promise;
    }
    const promise = task();
    this.operations.set(operationId, { key, promise });
    return promise;
  }
}
