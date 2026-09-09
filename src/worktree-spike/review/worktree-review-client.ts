import type { AppError } from '../../shared/contracts.js';
import { DomainError } from '../../shared/errors.js';
import { api, isPage, record, type ApiClient, type Guard } from '../../shared/client/api-client.js';
import type { DemoRole } from '../../shared/review-contracts.js';
import type { WorktreeReviewView } from './worktree-review-contracts.js';

export const isWorktreeReview: Guard<WorktreeReviewView> = (value): value is WorktreeReviewView => record(value)
  && ['id', 'srId', 'path', 'hash', 'body', 'requestComment', 'requestedAt'].every(key => typeof value[key] === 'string')
  && /^[a-f0-9]{64}$/.test(String(value.hash))
  && ['requested', 'approved', 'changes_requested'].includes(String(value.status))
  && (value.resultComment === undefined || typeof value.resultComment === 'string')
  && (value.decidedAt === undefined || typeof value.decidedAt === 'string');

type Receipt = { status: 'unknown' | 'in_progress' } | { status: 'committed'; receipt: { srId: string; kind: string; reviewId?: string } };
const isReceipt: Guard<Receipt> = (value): value is Receipt => record(value) && (value.status === 'unknown' || value.status === 'in_progress' || (value.status === 'committed' && record(value.receipt) && typeof value.receipt.srId === 'string' && ['worktree_review_request', 'worktree_review_result'].includes(String(value.receipt.kind)) && typeof value.receipt.reviewId === 'string'));
export const worktreeReviewsPath = (srId: string) => `/api/srs/${encodeURIComponent(srId)}/worktree-reviews`;
export const validReviewComment = (comment: string) => comment.trim().length > 0 && new TextEncoder().encode(comment).byteLength <= 65536;

export type WorktreeReviewMutationState = { status: 'idle' | 'saving' | 'unknown' | 'rejected' | 'succeeded'; operationId?: string; error?: AppError; message?: string; data?: WorktreeReviewView };

export class WorktreeReviewMutation {
  state: WorktreeReviewMutationState = { status: 'idle' };
  constructor(private readonly srId: string, private readonly role: DemoRole, private readonly notify: (state: WorktreeReviewMutationState) => void, private readonly client: ApiClient = api) {}
  private set(state: WorktreeReviewMutationState) { this.state = state; this.notify(state); }

  async submit(path: string, body: unknown): Promise<void> {
    if (this.state.status === 'saving' || this.state.status === 'unknown') return;
    const operationId = crypto.randomUUID(); this.set({ status: 'saving', operationId });
    try {
      const data = await this.client.request(path, isWorktreeReview, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId, 'X-Planrepo-Role': this.role }, body: JSON.stringify(body) });
      this.set({ status: 'succeeded', operationId, data });
    } catch (error) {
      if (error instanceof DomainError && !['OUTCOME_UNKNOWN', 'IN_PROGRESS', 'READ_FAILED'].includes(error.detail.code)) this.set({ status: 'rejected', operationId, error: error.detail });
      else this.set({ status: 'unknown', operationId, message: '처리 결과를 확인할 수 없습니다. 결과를 다시 확인해 주세요.' });
    }
  }

  async check(): Promise<void> {
    const operationId = this.state.operationId;
    if (!operationId || this.state.status !== 'unknown') return;
    try {
      const result = await this.client.request(`/api/operations/${operationId}`, isReceipt);
      if (this.state.operationId !== operationId || this.state.status !== 'unknown') return;
      if (result.status !== 'committed') { this.set({ status: 'unknown', operationId, message: result.status === 'in_progress' ? '처리 중입니다. 잠시 후 다시 확인해 주세요.' : '아직 처리 결과를 확인할 수 없습니다.' }); return; }
      const data = await this.client.request(`${worktreeReviewsPath(this.srId)}/${encodeURIComponent(result.receipt.reviewId!)}`, isWorktreeReview);
      this.set({ status: 'succeeded', operationId, data });
    } catch { if (this.state.operationId === operationId && this.state.status === 'unknown') this.set({ status: 'unknown', operationId, message: '결과 조회에 실패했습니다. 다시 확인해 주세요.' }); }
  }

  reset(): void { if (this.state.status === 'unknown') this.set({ status: 'idle' }); }
}

export const worktreeReviewPageGuard = isPage(isWorktreeReview);
