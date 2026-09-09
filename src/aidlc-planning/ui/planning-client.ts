import type { AppError } from '../../shared/contracts.js';
import { DomainError } from '../../shared/errors.js';
import { api, isRef, record, type ApiClient, type Guard } from '../../shared/client/api-client.js';
import { PLANNING_STAGES, type PlanningQuestion, type RunView, type WorkflowView } from '../../shared/planning-contracts.js';

const stage = (x: unknown) => PLANNING_STAGES.some(s => s.id === x);
const integer = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
const question = (x: unknown): x is PlanningQuestion => record(x) && typeof x.id === 'string' && typeof x.prompt === 'string' && Array.isArray(x.options) && x.options.every(o => typeof o === 'string');
export const isRun: Guard<RunView> = (x): x is RunView => record(x) && typeof x.id === 'string' && typeof x.srId === 'string' && stage(x.stage) && ['running', 'succeeded', 'failed'].includes(String(x.status)) && typeof x.startedAt === 'string' && Array.isArray(x.outputRefs) && x.outputRefs.every(isRef) && (x.summary === undefined || typeof x.summary === 'string') && (x.error === undefined || (record(x.error) && typeof x.error.code === 'string' && typeof x.error.message === 'string'));
export const isWorkflow: Guard<WorkflowView> = (x): x is WorkflowView => record(x) && typeof x.srId === 'string' && integer(x.revision) && integer(x.stageIndex) && stage(x.stage) && typeof x.stageLabel === 'string' && typeof x.column === 'string' && ['idle', 'running', 'awaiting_answers', 'awaiting_approval', 'approved', 'changes_requested', 'failed', 'complete'].includes(String(x.status)) && integer(x.inceptionCycle) && integer(x.constructionCycle) && Array.isArray(x.actions) && x.actions.every(a => ['generate', 'revise', 'next'].includes(String(a))) && typeof x.canComplete === 'boolean' && Array.isArray(x.reviewTargets) && x.reviewTargets.every(isRef) && (x.latestRun === undefined || isRun(x.latestRun)) && (x.latestRunId === undefined || typeof x.latestRunId === 'string') && (x.blockedReason === undefined || typeof x.blockedReason === 'string') && (x.questionSet === undefined || (record(x.questionSet) && typeof x.questionSet.id === 'string' && typeof x.questionSet.runId === 'string' && stage(x.questionSet.stage) && Array.isArray(x.questionSet.questions) && x.questionSet.questions.every(question) && (x.questionSet.answers === undefined || (record(x.questionSet.answers) && Object.values(x.questionSet.answers).every(a => typeof a === 'string')))));
type Receipt = { status: 'unknown' | 'in_progress' } | { status: 'committed'; receipt: { srId: string; kind: string; runId?: string } };
const isReceipt: Guard<Receipt> = (x): x is Receipt => record(x) && (x.status === 'unknown' || x.status === 'in_progress' || (x.status === 'committed' && record(x.receipt) && typeof x.receipt.srId === 'string' && ['planning_advance', 'planning_answer', 'planning_decide', 'planning_complete'].includes(String(x.receipt.kind)) && (x.receipt.kind !== 'planning_advance' || typeof x.receipt.runId === 'string')));
export interface PlanningMutationState { status: 'idle' | 'saving' | 'unknown' | 'rejected' | 'succeeded'; operationId?: string; error?: AppError; message?: string; data?: RunView | WorkflowView }
export const planningPath = (srId: string) => `/api/srs/${encodeURIComponent(srId)}`;
export function answersComplete(questions: PlanningQuestion[], answers: Record<string, string>): boolean { return questions.length > 0 && questions.every(q => !!answers[q.id]?.trim()); }

/** An uncertain write can only be resolved by an explicit read; never replay it. */
export class PlanningMutation {
  state: PlanningMutationState = { status: 'idle' };
  constructor(private srId: string, private notify: (state: PlanningMutationState) => void, private client: ApiClient = api) {}
  private set(state: PlanningMutationState) { this.state = state; this.notify(state); }
  async submit(kind: 'advance' | 'answers' | 'decisions' | 'complete', body: unknown): Promise<void> {
    if (this.state.status === 'saving' || this.state.status === 'unknown') return;
    const operationId = crypto.randomUUID();
    this.set({ status: 'saving', operationId });
    try {
      const data = await this.client.request<RunView | WorkflowView>(`${planningPath(this.srId)}/planning/${kind}`, kind === 'advance' ? isRun : isWorkflow, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId }, body: JSON.stringify(body) });
      this.set({ status: 'succeeded', operationId, data });
    } catch (e) {
      if (e instanceof DomainError && !['OUTCOME_UNKNOWN', 'IN_PROGRESS', 'READ_FAILED'].includes(e.detail.code)) this.set({ status: 'rejected', operationId, error: e.detail });
      else this.set({ status: 'unknown', operationId, message: '처리 결과가 확인되지 않았습니다. 입력을 유지하고 결과를 다시 확인해 주세요.' });
    }
  }
  async check(): Promise<void> {
    const operationId = this.state.operationId;
    if (!operationId || this.state.status !== 'unknown') return;
    try {
      const result = await this.client.request(`/api/operations/${operationId}`, isReceipt);
      if (this.state.operationId !== operationId || this.state.status !== 'unknown') return;
      if (result.status !== 'committed') { this.set({ status: 'unknown', operationId, message: result.status === 'in_progress' ? '처리 중입니다. 잠시 후 결과를 다시 확인해 주세요.' : '아직 처리 결과를 확인할 수 없습니다. 입력은 유지됩니다.' }); return; }
      if (result.receipt.srId !== this.srId) throw new Error('Receipt SR mismatch');
      const data = result.receipt.kind === 'planning_advance'
        ? await this.client.request(`${planningPath(this.srId)}/runs/${encodeURIComponent(result.receipt.runId!)}`, isRun)
        : await this.client.request(`${planningPath(this.srId)}/workflow`, isWorkflow);
      if (data.srId !== this.srId || (result.receipt.kind === 'planning_advance' && (!('id' in data) || data.id !== result.receipt.runId))) throw new Error('Receipt result mismatch');
      if (this.state.operationId !== operationId || this.state.status !== 'unknown') return;
      this.set({ status: 'succeeded', operationId, data });
    } catch { if (this.state.operationId === operationId && this.state.status === 'unknown') this.set({ status: 'unknown', operationId, message: '결과 조회에 실패했습니다. 다시 확인해 주세요.' }); }
  }
  async prepareNewAttempt(acknowledged: boolean): Promise<WorkflowView | undefined> {
    if (!acknowledged || this.state.status !== 'unknown') return;
    const operationId = this.state.operationId;
    try {
      const workflow = await this.client.request(`${planningPath(this.srId)}/workflow`, isWorkflow);
      if (workflow.srId !== this.srId) throw new Error('Workflow SR mismatch');
      if (this.state.operationId !== operationId || this.state.status !== 'unknown') return;
      this.set({ status: 'idle' });
      return workflow;
    } catch { if (this.state.operationId === operationId && this.state.status === 'unknown') this.set({ status: 'unknown', operationId, message: '최신 상태를 확인하지 못했습니다. 새 시도 준비를 다시 눌러 주세요.' }); }
  }
}
