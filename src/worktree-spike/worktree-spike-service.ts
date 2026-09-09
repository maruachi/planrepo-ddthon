import { fail } from '../shared/errors.js';
import {
  RESUME_PROMPT,
  type AidlcStateParserPort,
  type GitWorktreePort,
  type ManifestPort,
  type WorktreeAidlcRunnerPort,
  type WorktreeHandle,
  type WorktreeSpikeView,
} from './contracts.js';

interface SpikeDependencies {
  repositoryRoot?: string;
  workspaceRoot: string;
  git: GitWorktreePort;
  state: AidlcStateParserPort;
  manifest: ManifestPort;
  runner: WorktreeAidlcRunnerPort;
}

interface Operation {
  key: string;
  promise: Promise<WorktreeSpikeView>;
}

const initialView = (srId: string, configured: boolean): WorktreeSpikeView => ({
  srId,
  configured,
  readiness: 'absent',
  runStatus: 'idle',
  changedPaths: [],
});

export class WorktreeSpikeService {
  private readonly views = new Map<string, WorktreeSpikeView>();
  private readonly handles = new Map<string, WorktreeHandle>();
  private readonly operations = new Map<string, Operation>();

  constructor(private readonly dependencies: SpikeDependencies) {}

  get(srId: string): WorktreeSpikeView {
    return { ...(this.views.get(srId) ?? initialView(srId, !!this.dependencies.repositoryRoot)) };
  }

  provision(srId: string, operationId: string): Promise<WorktreeSpikeView> {
    return this.once(operationId, `provision:${srId}`, async () => {
      const repositoryRoot = this.dependencies.repositoryRoot;
      if (!repositoryRoot) fail('PLANNING_ACTION_BLOCKED', 'PLANREPO_REPOSITORY_PATH를 설정해 주세요.');
      const handle = await this.dependencies.git.provision(repositoryRoot, this.dependencies.workspaceRoot, srId);
      const parsed = await this.dependencies.state.parse(handle.worktreeRoot);
      this.handles.set(srId, handle);
      const view: WorktreeSpikeView = {
        srId,
        configured: true,
        readiness: handle.readiness,
        branch: handle.branch,
        worktreeRoot: handle.worktreeRoot,
        currentStage: parsed.currentStage,
        firstIncomplete: parsed.firstIncomplete,
        runStatus: this.views.get(srId)?.runStatus ?? 'idle',
        changedPaths: this.views.get(srId)?.changedPaths ?? [],
      };
      this.views.set(srId, view);
      return { ...view };
    });
  }

  resume(srId: string, operationId: string): Promise<WorktreeSpikeView> {
    return this.once(operationId, `resume:${srId}`, async () => {
      const handle = this.handles.get(srId);
      if (!handle) fail('PLANNING_ACTION_BLOCKED', '먼저 SR worktree를 준비해 주세요.');
      const current = this.get(srId);
      this.views.set(srId, { ...current, runStatus: 'running', error: undefined });
      try {
        const before = await this.dependencies.manifest.capture(handle.worktreeRoot);
        const outcome = await this.dependencies.runner.run({ srId, worktreeRoot: handle.worktreeRoot, prompt: RESUME_PROMPT, operationId });
        if (outcome.exitCode !== 0) fail('CLI_FAILED', 'AI-DLC 재개 실행에 실패했습니다.');
        const after = await this.dependencies.manifest.capture(handle.worktreeRoot);
        const delta = this.dependencies.manifest.diff(before, after);
        const parsed = await this.dependencies.state.parse(handle.worktreeRoot);
        const changedPaths = [...new Set([...delta.created, ...delta.modified, ...delta.deleted])].sort();
        const view: WorktreeSpikeView = {
          ...current,
          currentStage: parsed.currentStage,
          firstIncomplete: parsed.firstIncomplete,
          runStatus: 'succeeded',
          changedPaths,
          error: undefined,
        };
        this.views.set(srId, view);
        return { ...view };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI-DLC 재개 실행에 실패했습니다.';
        this.views.set(srId, { ...current, runStatus: 'failed', error: message });
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.dependencies.runner.close();
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
