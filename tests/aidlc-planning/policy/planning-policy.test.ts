import { describe, expect, it } from 'vitest';
import { initialWorkflow, PlanningPolicy } from '../../../src/aidlc-planning/policy/planning-policy.js';
import { unwrap } from '../../../src/shared/errors.js';
import type { WorkflowState } from '../../../src/shared/planning-contracts.js';

const policy = new PlanningPolicy();
const state = (patch: Partial<WorkflowState> = {}): WorkflowState => ({ ...initialWorkflow('sr'), ...patch });
describe('PlanningPolicy', () => {
  it('requires explicit approval, enters cycle one, preserves cycles on next and retry', () => {
    expect(policy.evaluate(state({ status: 'awaiting_approval' }), 'next').ok).toBe(false);
    const first = unwrap(policy.evaluate(state({ status: 'approved' }), 'next'));
    expect(first).toMatchObject({ stageIndex: 1, column: 'inception', inceptionCycle: 1 });
    const next = unwrap(policy.evaluate(state({ ...first, status: 'approved' }), 'next'));
    expect(next.inceptionCycle).toBe(1);
    const revised = unwrap(policy.evaluate(state({ ...next, status: 'changes_requested' }), 'revise'));
    expect(revised.inceptionCycle).toBe(2);
    expect(unwrap(policy.evaluate(state({ ...revised, status: 'failed' }), 'generate')).inceptionCycle).toBe(2);
    expect(unwrap(policy.evaluate(state({ stageIndex: 4, status: 'approved', inceptionCycle: 2 }), 'next'))).toMatchObject({ constructionCycle: 1, inceptionCycle: 2 });
  });
  it('blocks unresolved questions, running, complete, and next after the final stage', () => {
    expect(policy.evaluate(state({ questionSet: { id: 'q', runId: 'r', stage: 'requirements-analysis', questions: [{ id: 'a', prompt: '?', options: [] }] } }), 'generate').ok).toBe(false);
    for (const status of ['running', 'complete'] as const) for (const action of ['generate', 'revise', 'next'] as const) {
      expect(policy.evaluate(state({ status }), action).ok).toBe(false);
    }
    expect(policy.evaluate(state({ stageIndex: 8, status: 'approved' }), 'next').ok).toBe(false);
    expect(policy.evaluate(state({ status: 'idle', questionSet: { id: 'q', runId: 'r', stage: 'requirements-analysis', questions: [{ id: 'a', prompt: '?', options: [] }], answers: { a: 'yes' } } }), 'generate').ok).toBe(true);
  });
  it('finalize bypasses unresolved questions for requirements-analysis generate only', () => {
    const pending = state({ status: 'awaiting_answers', questionSet: { id: 'q', runId: 'r', stage: 'requirements-analysis', questions: [{ id: 'a', prompt: '?', options: [] }] } });
    expect(policy.evaluate(pending, 'generate').ok).toBe(false);
    expect(unwrap(policy.evaluate(pending, 'generate', true))).toMatchObject({ action: 'generate', stageIndex: 0, stage: 'requirements-analysis' });
    expect(policy.evaluate(pending, 'revise', true).ok).toBe(false);
    expect(policy.evaluate(state({ stageIndex: 1, status: 'awaiting_answers' }), 'generate', true).ok).toBe(false);
    expect(policy.evaluate(state({ status: 'running' }), 'generate', true).ok).toBe(false);
  });
  it('requires a nonempty outcome and never carries approval into new results', () => {
    const running = state({ status: 'running', decision: { id: 'd', stage: 'requirements-analysis', runId: 'old', kind: 'approve', comment: '', targets: [], createdAt: '' } });
    expect(policy.evaluateOutcome(running, { artifacts: [], questions: [], summary: '' }).ok).toBe(false);
    const questionOnly = unwrap(policy.evaluateOutcome(running, { artifacts: [], questions: [{ id: 'q', prompt: '?', options: [] }], summary: '' }));
    expect(questionOnly.status).toBe('awaiting_answers');
    expect(questionOnly.decision).toBeUndefined();
    expect(unwrap(policy.evaluateOutcome(running, { artifacts: [{ logicalKey: 'plan', title: 'Plan', body: 'body' }], questions: [], summary: '' })).status).toBe('awaiting_approval');
  });
});
