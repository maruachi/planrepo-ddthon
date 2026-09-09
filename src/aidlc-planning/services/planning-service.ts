import { createHash, randomUUID } from 'node:crypto';
import type { ActorContext, AppError, CommandContext, Result, VersionRef } from '../../shared/contracts.js';
import { errorOf, fail, result, unwrap } from '../../shared/errors.js';
import { id, text } from '../../shared/validation.js';
import { PLANNING_LIMITS, PLANNING_STAGES, type AnswerSubmission, type DecisionInput, type PlanningAction, type PlanningRun, type PlanRunnerPort, type RunnerOutcome, type RunView, type WorkflowState, type WorkflowView } from '../../shared/planning-contracts.js';
import { emptyChanges, type ChangeSet, type StorePort } from '../../sr-document-foundation/storage/store-port.js';
import type { DocumentService } from '../../sr-document-foundation/services/document-service.js';
import { PlanningPolicy, initialWorkflow } from '../policy/planning-policy.js';
import { PlanningContextBuilder } from '../context/planning-context-builder.js';
import { parseRunnerOutput } from '../cli/claude-plan-runner.js';

export type PlanningCommand =
  | { kind: 'planning_advance'; srId: string; revision: number; action: PlanningAction; finalize?: boolean }
  | { kind: 'planning_answer'; srId: string; questionSetId: string; answers: Record<string, string>; revision: number }
  | ({ kind: 'planning_decide'; srId: string; decision: DecisionInput })
  | { kind: 'planning_complete'; srId: string; revision: number };

const runView = ({ context: _context, inputRefs: _inputs, ...view }: PlanningRun): RunView => view;
const refsEqual = (a: VersionRef[], b: VersionRef[]) => {
  const key = (r: VersionRef) => `${r.srId}/${r.documentId}/${r.versionId}`;
  return a.length === b.length && a.map(key).sort().every((v, i) => v === b.map(key).sort()[i]);
};

export class PlanningService {
  private policy = new PlanningPolicy();
  private tasks = new Set<Promise<void>>();
  private closed = false;
  constructor(private store: StorePort, private docs: DocumentService, private context: PlanningContextBuilder, private runner: PlanRunnerPort) {}

  private state(srId: string): WorkflowState { id(srId); return unwrap(this.store.read({ kind: 'workflow', srId })) ?? initialWorkflow(srId); }
  private checkRevision(state: WorkflowState, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) fail('VALIDATION_ERROR', '올바른 계획 리비전이 필요합니다.');
    if (state.revision !== revision) fail('WORKFLOW_CONFLICT', '계획 상태가 변경되었습니다. 새로 확인해 주세요.');
  }
  private currentTargets(state: WorkflowState): VersionRef[] {
    return state.reviewTargets.map(target => unwrap(this.docs.readVersion(target)).latestVersionRef);
  }
  private approvalValid(state: WorkflowState): boolean {
    return state.status === 'approved' && state.decision?.kind === 'approve' && state.decision.runId === state.latestRunId && state.reviewTargets.length > 0 && refsEqual(state.decision.targets, this.currentTargets(state));
  }
  getWorkflow(srId: string): Result<WorkflowView> { return result(() => {
    const state = this.state(srId); const stage = PLANNING_STAGES[state.stageIndex];
    if (!stage) fail('INVALID_STAGE', '저장된 계획 단계를 확인할 수 없습니다.');
    const valid = this.approvalValid(state);
    const status = state.status === 'approved' && !valid ? 'awaiting_approval' : state.status;
    const evaluated = { ...state, status };
    const actions = (['generate', 'revise', 'next'] as const).filter(a => this.policy.evaluate(evaluated, a).ok);
    const canComplete = valid && state.stageIndex === PLANNING_STAGES.length - 1;
    return { ...state, status, reviewTargets: this.currentTargets(state), stage: stage.id, stageLabel: stage.label, actions: [...actions], canComplete,
      ...(state.status === 'approved' && !valid ? { blockedReason: '승인 이후 문서가 변경되었습니다. 최신 버전을 다시 검토해 주세요.' } : {}),
      ...(state.latestRunId ? { latestRun: unwrap(this.getRun(srId, state.latestRunId)) } : {}) };
  }); }
  getRun(srId: string, runId: string): Result<RunView> { return result(() => { id(srId); id(runId); return runView(unwrap(this.store.read({ kind: 'run', srId, runId }))); }); }

  private changes(state: WorkflowState, kind: string, summary: string, actor: ActorContext, targets: VersionRef[] = [], details?: unknown): ChangeSet {
    const c = emptyChanges(); c.requireSrs.push(state.srId);
    c.planning = { expectedRevision: state.revision || null, state: { ...state, revision: state.revision + 1 } };
    c.events.push({ id: randomUUID(), srId: state.srId, kind, summary, actor, occurredAt: new Date().toISOString(), versionRefs: targets, details });
    return c;
  }
  private commit(c: ChangeSet, command?: CommandContext, runId?: string) {
    if (command) { c.command = command; c.outcome = { kind: command.kind, srId: c.planning!.state.srId, changed: true, ...(runId ? { runId } : {}) }; }
    return unwrap(this.store.commit(c));
  }

  /** Replay is checked before revision validation, so lost responses never start another run. */
  command(command: PlanningCommand, actor: ActorContext, operationId: string): Result<RunView | WorkflowView> { return result(() => {
    id(operationId, 'operationId'); id(command.srId, 'srId');
    const context: CommandContext = { operationId, kind: command.kind, fingerprint: createHash('sha256').update(JSON.stringify([command, actor])).digest('hex') };
    const old = unwrap(this.store.read({ kind: 'receipt', operationId }));
    if (old) {
      if (old.kind !== context.kind || old.fingerprint !== context.fingerprint || old.srId !== command.srId) fail('OPERATION_CONFLICT', '같은 요청 식별자에 다른 내용이 있습니다.');
      return old.runId ? unwrap(this.getRun(old.srId, old.runId)) : unwrap(this.getWorkflow(old.srId));
    }
    switch (command.kind) {
      case 'planning_advance': return unwrap(this.advance(command.srId, command.action, actor, command.revision, context, command.finalize));
      case 'planning_answer': return unwrap(this.answer(command.srId, command.questionSetId, command, actor, context));
      case 'planning_decide': return unwrap(this.decide(command.srId, command.decision, actor, context));
      case 'planning_complete': return unwrap(this.completePlanning(command.srId, actor, command.revision, context));
    }
  }); }

  advance(srId: string, action: PlanningAction, actor: ActorContext, revision: number, command?: CommandContext, finalize = false): Result<RunView> { return result(() => {
    if (this.closed) fail('PLANNING_ACTION_BLOCKED', '앱이 종료 중입니다.');
    const old = this.state(srId); this.checkRevision(old, revision);
    if (action === 'next' && !this.approvalValid(old)) fail('APPROVAL_REQUIRED', '현재 최신 문서 묶음을 먼저 승인해 주세요.');
    const evaluation = unwrap(this.policy.evaluate(old, action, finalize));
    const now = new Date().toISOString(); const runId = randomUUID();
    const state: WorkflowState = { ...old, ...evaluation, latestRunId: runId, status: 'running', reviewTargets: [] };
    // Prior answers/decision are part of the execution input; new output replaces them only on completion.
    // finalize 는 남은 미응답 질문을 무시하고 지금까지의 대화로 문서를 만들라는 신호로 문맥에 전달한다.
    const snapshot = this.context.build(srId, runId, { stage: evaluation.stage, workflow: state, finalize });
    const inputs = snapshot.ok ? snapshot.data.documents.map(({ srId, documentId, versionId }) => ({ srId, documentId, versionId })) : [];
    const run: PlanningRun = { id: runId, srId, stage: evaluation.stage, status: 'running', startedAt: now, inputRefs: inputs, outputRefs: [], ...(snapshot.ok ? { context: snapshot.data } : {}) };
    const c = this.changes(old, 'planning_started', `${PLANNING_STAGES[evaluation.stageIndex].label} 생성을 시작했습니다.`, actor, inputs, { runId, action, stage: evaluation.stage, ...(finalize ? { finalize: true } : {}) });
    c.planning!.state = { ...state, revision: old.revision + 1 }; c.planning!.run = run;
    if (snapshot.ok) c.expectedDocumentSet = { srId, refs: inputs };
    if (action === 'next') c.expected = old.decision!.targets;
    this.commit(c, command, runId);
    const task = Promise.resolve().then(async () => {
      let outcome: Result<RunnerOutcome>;
      try { outcome = snapshot.ok ? await this.runner.execute(snapshot.data, {}) : snapshot; }
      catch (e) { outcome = { ok: false, error: errorOf(e, 'CLI_FAILED') }; }
      const finished = outcome.ok ? this.finishRun(srId, runId, outcome.data) : this.failRun(srId, runId, outcome.error);
      if (!finished.ok) console.error(JSON.stringify({ time: new Date().toISOString(), code: finished.error.code, runId }));
    }).finally(() => this.tasks.delete(task));
    this.tasks.add(task);
    return runView(run);
  }); }

  answer(srId: string, questionSetId: string, input: AnswerSubmission, actor: ActorContext, command?: CommandContext): Result<WorkflowView> { return result(() => {
    const state = this.state(srId); this.checkRevision(state, input.revision);
    if (state.status !== 'awaiting_answers' || !state.questionSet || state.questionSet.id !== questionSetId) fail('PLANNING_ACTION_BLOCKED', '현재 질문 집합을 확인해 주세요.');
    const keys = state.questionSet.questions.map(q => q.id);
    if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers) || Object.keys(input.answers).length !== keys.length || Object.keys(input.answers).some(k => !keys.includes(k))) fail('VALIDATION_ERROR', '모든 질문에 응답해 주세요.');
    const answers = Object.fromEntries(keys.map(key => [key, text(input.answers[key], key, PLANNING_LIMITS.answerBytes, true)]));
    const c = this.changes(state, 'planning_answered', '계획 질문에 응답했습니다.', actor, [], { questionSetId, stage: state.questionSet.stage, questions: state.questionSet.questions, answers });
    c.planning!.state = { ...c.planning!.state, status: 'idle', questionSet: { ...state.questionSet, answers } };
    this.commit(c, command); return unwrap(this.getWorkflow(srId));
  }); }

  decide(srId: string, input: DecisionInput, actor: ActorContext, command?: CommandContext): Result<WorkflowView> { return result(() => {
    const state = this.state(srId); this.checkRevision(state, input.revision);
    if (!['awaiting_approval', 'approved', 'changes_requested'].includes(state.status) || !state.latestRunId || !state.reviewTargets.length) fail('PLANNING_ACTION_BLOCKED', '검토할 계획 산출물이 필요합니다.');
    if (!['approve', 'request_changes'].includes(input.kind)) fail('VALIDATION_ERROR', '결정 종류를 확인해 주세요.');
    const current = this.currentTargets(state);
    if (!Array.isArray(input.targets) || !refsEqual(input.targets, current)) fail('VERSION_CONFLICT', '현재 최신 문서 묶음을 다시 확인해 주세요.');
    const comment = text(input.comment, 'comment', PLANNING_LIMITS.answerBytes, input.kind === 'request_changes');
    const decision = { id: randomUUID(), stage: PLANNING_STAGES[state.stageIndex].id, runId: state.latestRunId, kind: input.kind, comment, targets: current, createdAt: new Date().toISOString() };
    const c = this.changes(state, input.kind === 'approve' ? 'planning_approved' : 'planning_changes_requested', input.kind === 'approve' ? '계획 단계의 문서 묶음을 승인했습니다.' : '계획 수정을 요청했습니다.', actor, current, decision);
    c.expected = current; c.planning!.state = { ...c.planning!.state, status: input.kind === 'approve' ? 'approved' : 'changes_requested', decision, reviewTargets: current };
    this.commit(c, command); return unwrap(this.getWorkflow(srId));
  }); }

  completePlanning(srId: string, actor: ActorContext, revision: number, command?: CommandContext): Result<WorkflowView> { return result(() => {
    const state = this.state(srId); this.checkRevision(state, revision);
    if (state.stageIndex !== PLANNING_STAGES.length - 1 || !this.approvalValid(state)) fail('APPROVAL_REQUIRED', '마지막 코드 구현 계획을 승인한 뒤 완료할 수 있습니다.');
    const c = this.changes(state, 'planning_completed', '계획을 마치고 구현 대기로 이동했습니다.', actor, state.decision!.targets);
    c.expected = state.decision!.targets; c.planning!.state = { ...c.planning!.state, status: 'complete', column: 'implementation_ready' };
    this.commit(c, command); return unwrap(this.getWorkflow(srId));
  }); }

  finishRun(srId: string, runId: string, outcome: RunnerOutcome): Result<RunView> {
    const completed = result(() => {
      const valid = unwrap(parseRunnerOutput(JSON.stringify(outcome)));
      const state = this.state(srId); const run = unwrap(this.store.read({ kind: 'run', srId, runId }));
      if (run.status !== 'running' || state.status !== 'running' || state.latestRunId !== runId) fail('WORKFLOW_CONFLICT', '현재 실행이 아닙니다.');
      const next = unwrap(this.policy.evaluateOutcome(state, valid));
      const artifacts = valid.artifacts.map(a => {
        const existing = unwrap(this.store.read({ kind: 'documentKey', srId, logicalKey: a.logicalKey }));
        if (a.documentId && existing?.id !== a.documentId) fail('REFERENCE_MISMATCH', '생성 문서의 소속이나 키가 일치하지 않습니다.');
        return { ...a, ...(existing ? { documentId: existing.id } : {}) };
      });
      const newDocumentCount = artifacts.filter(a => !a.documentId).length;
      if (run.inputRefs.length + newDocumentCount > PLANNING_LIMITS.documents) fail('CONTEXT_TOO_LARGE', '저장 후 문서 수가 계획 문맥 상한을 초과합니다.');
      const c = unwrap(this.docs.prepareGenerated(srId, runId, artifacts));
      c.expectedDocumentSet = { srId, refs: run.inputRefs };
      next.revision = state.revision + 1; next.reviewTargets = c.pointers;
      if (valid.questions.length) next.questionSet = { id: randomUUID(), runId, stage: run.stage, questions: valid.questions };
      const finished: PlanningRun = { ...run, status: 'succeeded', completedAt: new Date().toISOString(), outputRefs: c.pointers, summary: valid.summary };
      c.planning = { expectedRevision: state.revision, state: next, run: finished };
      c.events.push({ id: randomUUID(), srId, kind: 'planning_succeeded', actor: { source: 'ai' }, occurredAt: finished.completedAt!, summary: '계획 생성 결과를 저장했습니다.', versionRefs: c.pointers, details: { runId, stage: run.stage, summary: valid.summary, questions: next.questionSet ?? null } });
      unwrap(this.store.commit(c)); return runView(finished);
    }, 'STORAGE_FAILED');
    if (completed.ok) return completed;
    const run = this.store.read({ kind: 'run', srId, runId });
    if (run.ok && run.data.status === 'running') return this.failRun(srId, runId, completed.error);
    return completed;
  }
  private failRun(srId: string, runId: string, error: AppError): Result<RunView> { return result(() => {
    const state = this.state(srId); const run = unwrap(this.store.read({ kind: 'run', srId, runId }));
    if (run.status !== 'running' || state.latestRunId !== runId) fail('WORKFLOW_CONFLICT', '이미 종료된 실행입니다.');
    const c = this.changes(state, 'planning_failed', '계획 생성에 실패했습니다.', { source: 'system' }, [], { runId, code: error.code, message: error.message });
    const finished: PlanningRun = { ...run, status: 'failed', completedAt: new Date().toISOString(), error };
    c.planning!.state.status = 'failed'; delete c.planning!.state.questionSet; delete c.planning!.state.decision;
    c.planning!.run = finished; unwrap(this.store.commit(c)); return runView(finished);
  }, 'STORAGE_FAILED'); }

  recoverInterrupted(): Result<number> { return result(() => {
    const runs = unwrap(this.store.read({ kind: 'runningRuns' }));
    for (const run of runs) unwrap(this.failRun(run.srId, run.id, { code: 'CLI_INTERRUPTED', message: '이전 앱 실행이 중단되었습니다. 다시 생성해 주세요.' }));
    return runs.length;
  }); }
  async waitForIdle(): Promise<void> { await Promise.allSettled([...this.tasks]); }
  async close(): Promise<void> { this.closed = true; await this.runner.close?.(); await this.waitForIdle(); }
}
