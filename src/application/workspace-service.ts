import type { ProjectScope } from '@/src/contracts/context';
import type { DomainError } from '@/src/contracts/results';
import type { DemoActorView, WorkspaceView } from '@/src/contracts/views';
import type { Persistence } from '@/src/persistence/transaction';
import { readWorkspace } from '@/src/persistence/workspace-repository';

export class WorkspaceServiceError extends Error {
  constructor(readonly domainError: DomainError) {
    super(domainError.message);
  }
}

function reject(
  code: Extract<DomainError['code'], 'FORBIDDEN' | 'NOT_FOUND' | 'STORE_UNAVAILABLE'>,
  message: string,
): never {
  throw new WorkspaceServiceError({
    code,
    message,
    blockers: [],
    assigneeIds: [],
    targetRefs: [],
  });
}

function actorView(
  projectId: string,
  membership: {
    readonly actorId: string;
    readonly displayName: string;
    readonly roles: readonly string[];
  },
): DemoActorView {
  return {
    actorId: membership.actorId,
    displayName: membership.displayName,
    projectId,
    roles: membership.roles,
    demo: true,
  };
}

export interface WorkspaceService {
  describeWorkspace(actorId: string | undefined, scope: ProjectScope): WorkspaceView;
  selectDemoActor(scope: ProjectScope, actorId: string): DemoActorView;
}

export function createWorkspaceService(persistence: Persistence): WorkspaceService {
  return {
    describeWorkspace(actorId, scope) {
      if (actorId === undefined || actorId.length === 0) {
        return reject('FORBIDDEN', '현재 가상 사용자를 선택해야 합니다.');
      }
      let workspace: ReturnType<typeof readWorkspace>;
      try {
        workspace = persistence.readConsistent((db) => readWorkspace(db, scope.projectId));
      } catch {
        return reject('STORE_UNAVAILABLE', '작업 공간 설정을 안전하게 읽을 수 없습니다.');
      }
      if (workspace === undefined) {
        return reject('NOT_FOUND', '작업 공간을 찾을 수 없습니다.');
      }
      if (!workspace.memberships.some((item) => item.actorId === actorId)) {
        return reject('FORBIDDEN', '현재 프로젝트 멤버가 아닙니다.');
      }
      return {
        project: workspace.project,
        actors: workspace.memberships.map((membership) =>
          actorView(scope.projectId, membership),
        ),
        connection: { kind: 'mock', available: true },
        revision: workspace.project.revision,
        ...(workspace.defaultPolicyRef === undefined ? {} : { defaultPolicyRef: workspace.defaultPolicyRef }),
        policies: workspace.policies,
      };
    },
    selectDemoActor(scope, actorId) {
      let workspace: ReturnType<typeof readWorkspace>;
      try {
        workspace = persistence.readConsistent((db) => readWorkspace(db, scope.projectId));
      } catch {
        return reject('STORE_UNAVAILABLE', '작업 공간 설정을 안전하게 읽을 수 없습니다.');
      }
      if (workspace === undefined) {
        return reject('NOT_FOUND', '작업 공간을 찾을 수 없습니다.');
      }
      const membership = workspace.memberships.find(
        (candidate) => candidate.actorId === actorId,
      );
      if (membership === undefined) {
        return reject('NOT_FOUND', '선택한 가상 사용자를 찾을 수 없습니다.');
      }
      return actorView(scope.projectId, membership);
    },
  };
}
