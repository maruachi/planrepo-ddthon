import { api, record, type ApiClient, type Guard } from '../../shared/client/api-client.js';
import type { WorktreeSpikeView } from '../contracts.js';

const keys = new Set(['srId', 'configured', 'readiness', 'branch', 'worktreeRoot', 'currentStage', 'firstIncomplete', 'runStatus', 'changedPaths', 'error']);
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';

export const isWorktreeSpikeView: Guard<WorktreeSpikeView> = (value): value is WorktreeSpikeView => record(value)
  && Object.keys(value).every(key => keys.has(key))
  && typeof value.srId === 'string'
  && typeof value.configured === 'boolean'
  && (value.readiness === 'absent' || value.readiness === 'ready')
  && optionalString(value.branch)
  && optionalString(value.worktreeRoot)
  && optionalString(value.currentStage)
  && optionalString(value.firstIncomplete)
  && ['idle', 'running', 'succeeded', 'failed'].includes(String(value.runStatus))
  && Array.isArray(value.changedPaths)
  && value.changedPaths.every(path => typeof path === 'string')
  && optionalString(value.error);

export const worktreeSpikePath = (srId: string) => `/api/srs/${encodeURIComponent(srId)}/worktree-spike`;

export class WorktreeSpikeClient {
  constructor(
    private readonly client: ApiClient = api,
    private readonly operationId: () => string = () => crypto.randomUUID(),
  ) {}

  status(srId: string): Promise<WorktreeSpikeView> {
    return this.client.request(worktreeSpikePath(srId), isWorktreeSpikeView);
  }

  provision(srId: string): Promise<WorktreeSpikeView> {
    return this.mutate(srId, 'provision');
  }

  resume(srId: string): Promise<WorktreeSpikeView> {
    return this.mutate(srId, 'resume');
  }

  private mutate(srId: string, action: 'provision' | 'resume'): Promise<WorktreeSpikeView> {
    return this.client.request(`${worktreeSpikePath(srId)}/${action}`, isWorktreeSpikeView, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operation-Id': this.operationId() },
      body: JSON.stringify({}),
    });
  }
}

export const worktreeSpikeClient = new WorktreeSpikeClient();
