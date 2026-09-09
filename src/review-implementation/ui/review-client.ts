import type { AppError, SR } from '../../shared/contracts.js';
import { DomainError } from '../../shared/errors.js';
import { api, isRef, isSR, record, type ApiClient, type Guard } from '../../shared/client/api-client.js';
import type { DemoRole, ReviewView } from '../../shared/review-contracts.js';

export const isReview: Guard<ReviewView> = (x): x is ReviewView => record(x) && ['id', 'srId', 'requestComment', 'requestedAt', 'documentTitle'].every(k => typeof x[k] === 'string') && isRef(x.target) && isRef(x.latestVersionRef) && typeof x.isLatest === 'boolean' && Number.isSafeInteger(x.versionNumber) && Number(x.versionNumber) > 0 && ['requested', 'approved', 'changes_requested'].includes(String(x.status)) && (x.resultComment === undefined || typeof x.resultComment === 'string') && (x.decidedAt === undefined || typeof x.decidedAt === 'string');
type Receipt = { status: 'unknown' | 'in_progress' } | { status: 'committed'; receipt: { srId: string; kind: 'review_request' | 'review_result' | 'mark_implemented'; reviewId?: string } };
const isReceipt: Guard<Receipt> = (x): x is Receipt => record(x) && (x.status === 'unknown' || x.status === 'in_progress' || (x.status === 'committed' && record(x.receipt) && typeof x.receipt.srId === 'string' && ['review_request', 'review_result', 'mark_implemented'].includes(String(x.receipt.kind)) && (x.receipt.kind === 'mark_implemented' || typeof x.receipt.reviewId === 'string')));
export const reviewBase = (srId: string) => `/api/srs/${encodeURIComponent(srId)}`;
export const validComment = (comment: string) => comment.trim().length > 0 && new TextEncoder().encode(comment).byteLength <= 65536;
export interface ReviewMutationState { status: 'idle' | 'saving' | 'unknown' | 'rejected' | 'succeeded'; operationId?: string; error?: AppError; message?: string; data?: ReviewView | SR }
export class ReviewMutation {
  state: ReviewMutationState = { status: 'idle' };
  constructor(private srId: string, private role: DemoRole, private notify: (state: ReviewMutationState) => void, private client: ApiClient = api) {}
  private set(state: ReviewMutationState) { this.state = state; this.notify(state); }
  async submit(path: string, body: unknown, implementation = false): Promise<void> {
    if (this.state.status === 'saving' || this.state.status === 'unknown') return;
    const operationId = crypto.randomUUID(); this.set({ status: 'saving', operationId });
    try {
      const data = await this.client.request<ReviewView | SR>(`${reviewBase(this.srId)}${path}`, implementation ? isSR : isReview, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId, 'X-Planrepo-Role': this.role }, body: JSON.stringify(body) });
      this.set({ status: 'succeeded', operationId, data });
    } catch (e) {
      if (e instanceof DomainError && !['OUTCOME_UNKNOWN', 'IN_PROGRESS', 'READ_FAILED'].includes(e.detail.code)) this.set({ status: 'rejected', operationId, error: e.detail });
      else this.set({ status: 'unknown', operationId, message: '처리 결과를 확인할 수 없습니다. 입력을 유지하고 결과를 다시 확인해 주세요.' });
    }
  }
  async check(): Promise<void> {
    const operationId = this.state.operationId; if (!operationId || this.state.status !== 'unknown') return;
    const current = () => this.state.operationId === operationId && this.state.status === 'unknown';
    try {
      const result = await this.client.request(`/api/operations/${operationId}`, isReceipt); if (!current()) return;
      if (result.status !== 'committed') { this.set({ status: 'unknown', operationId, message: result.status === 'in_progress' ? '처리 중입니다. 잠시 후 다시 확인해 주세요.' : '이전 요청의 결과가 아직 확인되지 않았습니다.' }); return; }
      if (result.receipt.srId !== this.srId) throw new Error('Wrong SR receipt');
      const receipt = result.receipt;
      const data = receipt.kind === 'mark_implemented' ? await this.client.request(reviewBase(this.srId), isSR) : await this.client.request(`${reviewBase(this.srId)}/reviews/${encodeURIComponent(receipt.reviewId!)}`, isReview);
      if (receipt.kind !== 'mark_implemented' && (!('target' in data) || data.id !== receipt.reviewId || data.srId !== this.srId)) throw new Error('Wrong review receipt');
      if (receipt.kind === 'mark_implemented' && data.id !== this.srId) throw new Error('Wrong SR');
      if (current()) this.set({ status: 'succeeded', operationId, data });
    } catch { if (current()) this.set({ status: 'unknown', operationId, message: '결과 조회에 실패했습니다. 다시 확인해 주세요.' }); }
  }
  /** Called only after an explicit confirmation and a successful UI refresh. */
  prepareNewAttempt(acknowledged: boolean): boolean {
    if (!acknowledged || this.state.status !== 'unknown') return false;
    this.set({ status: 'idle' }); return true;
  }
}
