import type { AppError, MutationResult, SR } from '../contracts.js';
import { DomainError } from '../errors.js';
import { ApiClient, isDocument, isMutation, isOperation, isSR, versionURL } from './api-client.js';
export interface OperationState { status: 'idle' | 'saving' | 'succeeded' | 'rejected' | 'conflict' | 'unknown'; operationId?: string; error?: AppError; data?: SR | MutationResult; message?: string }
export class OperationTracker {
  state: OperationState = { status: 'idle' };
  constructor(private client: ApiClient, private notify: (state: OperationState) => void = () => {}) {}
  private set(state: OperationState): void { this.state = state; this.notify(state); }
  reset(): void { if (this.state.status !== 'saving') this.set({ status: 'idle' }); }
  async submit(path: string, body: unknown): Promise<void> {
    if (this.state.status === 'saving' || this.state.status === 'unknown') return;
    const operationId = crypto.randomUUID(); this.set({ status: 'saving', operationId });
    try {
      const data = await this.client.request<SR | MutationResult>(path, path === '/api/srs' ? isSR : isMutation, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId }, body: JSON.stringify(body) });
      this.set({ status: 'succeeded', operationId, data });
    } catch (e) {
      if (e instanceof DomainError && !['OUTCOME_UNKNOWN', 'IN_PROGRESS', 'READ_FAILED'].includes(e.detail.code)) this.set({ status: e.detail.code === 'VERSION_CONFLICT' ? 'conflict' : 'rejected', operationId, error: e.detail });
      else { this.set({ status: 'unknown', operationId, message: '저장 여부를 확인하고 있습니다. 입력은 유지됩니다.' }); await this.check(); }
    }
  }
  async check(): Promise<void> {
    const operationId = this.state.operationId; if (!operationId || this.state.status === 'saving') return;
    try {
      const value = await this.client.request(`/api/operations/${operationId}`, isOperation);
      if (value.status !== 'committed') { this.set({ status: 'unknown', operationId, message: value.status === 'in_progress' ? '처리 중입니다. 잠시 후 결과를 다시 확인해 주세요.' : '저장 여부가 아직 확인되지 않았습니다. 입력을 유지하고 결과를 다시 확인해 주세요.' }); return; }
      const receipt = value.receipt;
      const data = receipt.kind === 'create' ? await this.client.request(`/api/srs/${receipt.srId}`, isSR) : { view: await this.client.request(versionURL(receipt.ref!), isDocument), changed: receipt.changed };
      this.set({ status: 'succeeded', operationId, data });
    } catch { this.set({ status: 'unknown', operationId, message: '저장 결과를 확인하지 못했습니다. 입력을 유지하고 다시 확인해 주세요.' }); }
  }
}
