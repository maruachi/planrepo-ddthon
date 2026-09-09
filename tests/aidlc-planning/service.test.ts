import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHOR, type Result } from '../../src/shared/contracts.js';
import { unwrap } from '../../src/shared/errors.js';
import { PLANNING_STAGES, type ContextSnapshot, type PlanRunnerPort, type RunnerOutcome } from '../../src/shared/planning-contracts.js';
import { PlanningService } from '../../src/aidlc-planning/services/planning-service.js';
import { PlanningContextBuilder } from '../../src/aidlc-planning/context/planning-context-builder.js';
import { initialWorkflow } from '../../src/aidlc-planning/policy/planning-policy.js';
import { emptyChanges } from '../../src/sr-document-foundation/storage/store-port.js';
import { services } from '../sr-document-foundation/helpers/test-db.js';

const output = (key = 'requirements-analysis'): RunnerOutcome => ({ artifacts: [{ logicalKey: key, title: '계획', body: '검토할 계획 본문' }], questions: [], summary: '계획 생성 완료' });
class FakeRunner implements PlanRunnerPort {
  contexts: ContextSnapshot[] = [];
  respond: (context: ContextSnapshot) => Promise<Result<RunnerOutcome>> = async context => ({ ok: true, data: output(context.stage) });
  execute(context: ContextSnapshot) { this.contexts.push(context); return this.respond(context); }
}
function setup() {
  const t = services(); const runner = new FakeRunner();
  const planning = new PlanningService(t.store, t.docs, new PlanningContextBuilder(t.store, resolve('.aidlc-rule-details')), runner);
  const sr = unwrap(t.sr.create({ title: '기획 SR', description: '요구사항 원문\r\n' }, AUTHOR));
  const view = () => unwrap(planning.getWorkflow(sr.id));
  const approve = () => { const v = view(); return unwrap(planning.decide(sr.id, { kind: 'approve', comment: '', targets: v.reviewTargets, revision: v.revision }, AUTHOR)); };
  const generate = async (action: 'generate' | 'revise' | 'next' = 'generate') => { const run = unwrap(planning.advance(sr.id, action, AUTHOR, view().revision)); await planning.waitForIdle(); return unwrap(planning.getRun(sr.id, run.id)); };
  return { ...t, runner, planning, sr, view, approve, generate };
}

describe('PlanningService persistence and workflow', () => {
  it('traverses all nine stages only after approval and ends at implementation-ready', async () => {
    const t = setup();
    try {
      for (let i = 0; i < PLANNING_STAGES.length; i++) {
        const run = await t.generate(i === 0 ? 'generate' : 'next');
        expect(run.status).toBe('succeeded');
        expect(t.view()).toMatchObject({ stageIndex: i, status: 'awaiting_approval', column: PLANNING_STAGES[i].column });
        expect(t.planning.advance(t.sr.id, 'next', AUTHOR, t.view().revision).ok).toBe(false);
        expect(t.planning.completePlanning(t.sr.id, AUTHOR, t.view().revision).ok).toBe(false);
        const approved = t.approve();
        expect(approved.canComplete).toBe(i === PLANNING_STAGES.length - 1);
        expect(approved.inceptionCycle).toBe(i >= 1 ? 1 : 0);
        expect(approved.constructionCycle).toBe(i >= 5 ? 1 : 0);
      }
      expect(t.planning.advance(t.sr.id, 'next', AUTHOR, t.view().revision).ok).toBe(false);
      expect(unwrap(t.planning.completePlanning(t.sr.id, AUTHOR, t.view().revision))).toMatchObject({ status: 'complete', column: 'implementation_ready' });
      expect(unwrap(t.store.read({ kind: 'sr', srId: t.sr.id })).column).toBe('implementation_ready');
      expect(t.runner.contexts).toHaveLength(9);
      expect(t.runner.contexts.at(-1)?.rules).not.toContain('# PART 2: GENERATION');
    } finally { t.close(); }
  });

  it('increments revisions and cycles on revise, preserves cycle on failure retry, and rejects stale approval', async () => {
    const t = setup();
    try {
      await t.generate(); t.approve(); await t.generate('next');
      expect(t.view().inceptionCycle).toBe(1);
      const oldRevision = t.view().revision;
      expect((await t.generate('revise')).status).toBe('succeeded');
      expect(t.view().inceptionCycle).toBe(2);
      expect(t.planning.advance(t.sr.id, 'revise', AUTHOR, oldRevision)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_CONFLICT' } });
      const approved = t.approve();
      const target = approved.reviewTargets[0]!;
      unwrap(t.docs.edit(target, '검토 이후 사람 수정', AUTHOR));
      expect(t.view()).toMatchObject({ status: 'awaiting_approval', canComplete: false });
      expect(t.planning.advance(t.sr.id, 'next', AUTHOR, t.view().revision)).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
      t.runner.respond = async () => ({ ok: false, error: { code: 'CLI_FAILED', message: 'failed' } });
      expect((await t.generate('revise')).status).toBe('failed');
      expect(t.view().inceptionCycle).toBe(3);
      t.runner.respond = async context => ({ ok: true, data: output(context.stage) });
      expect((await t.generate()).status).toBe('succeeded');
      expect(t.view().inceptionCycle).toBe(3);
    } finally { t.close(); }
  });

  it('accepts question-only output and carries all answers and event details into the next generation', async () => {
    const t = setup();
    try {
      t.runner.respond = async () => ({ ok: true, data: { artifacts: [], questions: [{ id: 'audience', prompt: '사용자는 누구인가요?', options: [] }], summary: '답변 필요' } });
      expect((await t.generate()).status).toBe('succeeded');
      const pending = t.view(); expect(pending.status).toBe('awaiting_answers');
      expect(t.planning.advance(t.sr.id, 'generate', AUTHOR, pending.revision).ok).toBe(false);
      const qid = pending.questionSet!.id;
      expect(t.planning.answer(t.sr.id, qid, { revision: pending.revision, answers: {} }, AUTHOR).ok).toBe(false);
      expect(t.planning.answer(t.sr.id, qid, { revision: pending.revision, answers: { audience: ' ' } }, AUTHOR).ok).toBe(false);
      expect(unwrap(t.planning.answer(t.sr.id, qid, { revision: pending.revision, answers: { audience: '내부 개발팀' } }, AUTHOR)).status).toBe('idle');
      t.runner.respond = async context => ({ ok: true, data: output(context.stage) });
      await t.generate();
      const context = t.runner.contexts.at(-1)!;
      expect(context.workflow.questionSet?.answers).toEqual({ audience: '내부 개발팀' });
      expect(context.history.find(e => e.kind === 'planning_answered')?.details).toMatchObject({ answers: { audience: '내부 개발팀' } });
      expect(t.view().questionSet).toBeUndefined();
      expect(t.view().status).toBe('awaiting_approval');
    } finally { t.close(); }
  });

  it('rejects next if the approved input is edited while building its execution context', async () => {
    const t = setup();
    try {
      await t.generate();
      const approved = t.approve();
      const target = approved.reviewTargets[0]!;
      class EditingContext extends PlanningContextBuilder {
        override build(...args: Parameters<PlanningContextBuilder['build']>) {
          unwrap(t.docs.edit(target, '승인 확인 직후 수정한 최신 내용', AUTHOR));
          return super.build(...args);
        }
      }
      const next = new PlanningService(t.store, t.docs, new EditingContext(t.store, resolve('.aidlc-rule-details')), t.runner);
      const attempt = next.advance(t.sr.id, 'next', AUTHOR, approved.revision);
      await next.waitForIdle();
      expect(attempt).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
      expect(t.runner.contexts).toHaveLength(1);
      expect(t.view()).toMatchObject({ stageIndex: 0, status: 'awaiting_approval', revision: approved.revision });
      expect(unwrap(t.docs.readVersion(unwrap(t.docs.readVersion(target)).latestVersionRef)).body).toBe('승인 확인 직후 수정한 최신 내용');
      expect(t.db.prepare('SELECT id FROM planning_runs').all()).toHaveLength(1);
    } finally { t.close(); }
  });

  it('rejects a late output atomically and preserves a human edit made during the run', async () => {
    const t = setup();
    try {
      await t.generate();
      const original = t.view().reviewTargets[0]!;
      let release!: (value: Result<RunnerOutcome>) => void;
      t.runner.respond = () => new Promise(resolve => { release = resolve; });
      const run = unwrap(t.planning.advance(t.sr.id, 'revise', AUTHOR, t.view().revision));
      await Promise.resolve();
      const edit = unwrap(t.docs.edit(original, '동시 편집 내용 보존\r\n', AUTHOR));
      release({ ok: true, data: output() }); await t.planning.waitForIdle();
      expect(unwrap(t.planning.getRun(t.sr.id, run.id))).toMatchObject({ status: 'failed', error: { code: 'VERSION_CONFLICT' }, outputRefs: [] });
      expect(unwrap(t.docs.readVersion(edit.view.latestVersionRef)).body).toBe('동시 편집 내용 보존\r\n');
      expect(unwrap(t.docs.listVersions(t.sr.id, original.documentId)).items).toHaveLength(2);
      expect(t.view().status).toBe('failed');
    } finally { t.close(); }
  });

  it('replays a committed operation after completion without executing a second run', async () => {
    const t = setup();
    try {
      const operationId = randomUUID(); const command = { kind: 'planning_advance' as const, srId: t.sr.id, revision: 0, action: 'generate' as const };
      const first = unwrap(t.planning.command(command, AUTHOR, operationId));
      await t.planning.waitForIdle();
      const replay = unwrap(t.planning.command(command, AUTHOR, operationId));
      expect(replay).toMatchObject({ id: 'id' in first ? first.id : '', status: 'succeeded' });
      expect(t.runner.contexts).toHaveLength(1);
      expect(t.planning.command({ ...command, action: 'revise' }, AUTHOR, operationId)).toMatchObject({ ok: false, error: { code: 'OPERATION_CONFLICT' } });
      expect(t.planning.advance(t.sr.id, 'generate', AUTHOR, 0)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_CONFLICT' } });
    } finally { t.close(); }
  });

  it('recovers persisted interrupted runs without invoking the runner', () => {
    const t = setup();
    try {
      const runId = randomUUID(); const c = emptyChanges(); c.requireSrs = [t.sr.id];
      c.planning = { expectedRevision: null, state: { ...initialWorkflow(t.sr.id), revision: 1, latestRunId: runId, status: 'running', column: 'requirements_analysis' }, run: { id: runId, srId: t.sr.id, stage: 'requirements-analysis', status: 'running', startedAt: new Date().toISOString(), inputRefs: [], outputRefs: [] } };
      unwrap(t.store.commit(c));
      expect(unwrap(t.planning.recoverInterrupted())).toBe(1);
      expect(unwrap(t.planning.getRun(t.sr.id, runId))).toMatchObject({ status: 'failed', error: { code: 'CLI_INTERRUPTED' } });
      expect(t.view().actions).toContain('generate');
      expect(unwrap(t.planning.recoverInterrupted())).toBe(0);
      expect(t.runner.contexts).toHaveLength(0);
    } finally { t.close(); }
  });
});
