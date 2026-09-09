import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PlanningContextBuilder } from '../../../src/aidlc-planning/context/planning-context-builder.js';
import { initialWorkflow } from '../../../src/aidlc-planning/policy/planning-policy.js';
import type { DocumentView, HistoryEvent, SR } from '../../../src/shared/contracts.js';
import { unwrap } from '../../../src/shared/errors.js';
import type { ReadQuery, StorePort } from '../../../src/sr-document-foundation/storage/store-port.js';

const actor = { source: 'user', role: 'author' } as const;
const sr: SR = { id: 's', title: 'SR', description: 'full input', actor, column: 'sr_list', createdAt: '' };
const doc = (id: string): DocumentView => ({ srId: 's', documentId: id, versionId: `v${id}`, latestVersionRef: { srId: 's', documentId: id, versionId: `v${id}` }, body: `full body ${id}`, title: id, actor, origin: 'human_edit', versionNumber: 1, isLatest: true, createdAt: '' });
const event = (id: string): HistoryEvent => ({ id, srId: 's', sequence: Number(id), kind: 'decision', actor, occurredAt: '', summary: 'summary', versionRefs: [], details: { answer: `full details ${id}` } });
function fixture(overflow = false, failing = false): { store: StorePort; calls: ReadQuery[] } {
  const calls: ReadQuery[] = [];
  const store = { read(query: ReadQuery) {
    calls.push(query);
    if (query.kind === 'sr') return { ok: true, data: sr };
    if (query.kind === 'documents') return { ok: true, data: { items: [{ ...doc(query.options?.cursor ? '2' : '1'), logicalKey: query.options?.cursor ? 'stable-design-key' : 'stable-requirements-key' }], nextCursor: query.options?.cursor ? null : 'doc-page-2' } };
    if (query.kind === 'version') return { ok: true, data: { ...doc(query.target.documentId), ...(overflow ? { body: 'x'.repeat(8 * 1024 * 1024) } : {}) } };
    if (query.kind === 'history') return { ok: true, data: { items: [{ ...event(query.options?.cursor ? '1' : '2'), details: undefined }], nextCursor: query.options?.cursor ? null : 'history-page-2' } };
    if (query.kind === 'event') return failing ? { ok: false, error: { code: 'READ_FAILED', message: 'failure' } } : { ok: true, data: event(query.eventId) };
    throw new Error('Unexpected query');
  } } as StorePort;
  return { store, calls };
}
const root = resolve('.aidlc-rule-details');
describe('PlanningContextBuilder', () => {
  it('loads all document pages, full event details, and original answers without aliasing state', () => {
    const { store, calls } = fixture();
    const workflow = initialWorkflow('s');
    workflow.questionSet = { id: 'q', runId: 'r', stage: 'requirements-analysis', questions: [{ id: '1', prompt: '?', options: [] }], answers: { '1': 'my answer' } };
    const snapshot = unwrap(new PlanningContextBuilder(store, root).build('s', 'r', { stage: 'requirements-analysis', workflow }));
    expect(snapshot.documents.map(d => d.body)).toEqual(['full body 1', 'full body 2']);
    expect(snapshot.documents.map(d => d.logicalKey)).toEqual(['stable-requirements-key', 'stable-design-key']);
    expect(snapshot.history.map(e => e.details)).toEqual([{ answer: 'full details 2' }, { answer: 'full details 1' }]);
    expect(snapshot.workflow.questionSet?.answers).toEqual({ '1': 'my answer' });
    workflow.questionSet.answers!['1'] = 'changed';
    expect(snapshot.workflow.questionSet?.answers?.['1']).toBe('my answer');
    expect(calls.filter(q => q.kind === 'event')).toHaveLength(2);
  });
  it('propagates the finalize signal into the snapshot and defaults it off', () => {
    const workflow = initialWorkflow('s');
    const build = (finalize?: boolean) => unwrap(new PlanningContextBuilder(fixture().store, root).build('s', 'r', { stage: 'requirements-analysis', workflow, finalize }));
    expect(build(true).finalize).toBe(true);
    expect(build(false).finalize).toBe(false);
    expect(build().finalize).toBe(false);
  });
  it('fails oversized context and storage errors without returning partial data', () => {
    const spec = { stage: 'requirements-analysis' as const, workflow: initialWorkflow('s') };
    expect(new PlanningContextBuilder(fixture(true).store, root).build('s', 'r', spec)).toMatchObject({ ok: false, error: { code: 'CONTEXT_TOO_LARGE' } });
    expect(new PlanningContextBuilder(fixture(false, true).store, root).build('s', 'r', spec)).toMatchObject({ ok: false, error: { code: 'READ_FAILED' } });
  });
  it('restricts final-stage rules to Part 1 and preserves product approval boundaries', () => {
    const rules = unwrap(new PlanningContextBuilder(fixture().store, root).loadRules({ stage: 'code-generation-plan', workflow: { ...initialWorkflow('s'), stageIndex: 8 } }));
    expect(rules).toContain('# PART 1: PLANNING');
    expect(rules).not.toContain('# PART 2: GENERATION');
    expect(rules).not.toContain('## Step 10: Load Unit Code Generation Plan');
    expect(rules).toContain('never invent user answers or approval');
    expect(rules).toContain('Optional extensions are disabled');
  });
});
