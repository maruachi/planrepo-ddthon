import type { DatabaseConnection } from './database';
import type { ReviewPolicyVersionRef } from '@/src/contracts/context';
import type { PolicyView } from '@/src/contracts/views';
import { readPolicies } from './review-policy-repository';

export interface StoredWorkspaceProject {
  readonly projectId: string;
  readonly teamId: string;
  readonly name: string;
  readonly revision: number;
}

export interface StoredDemoMembership {
  readonly actorId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly revision: number;
}

export interface StoredWorkspace {
  readonly project: StoredWorkspaceProject;
  readonly memberships: readonly StoredDemoMembership[];
  readonly defaultPolicyRef?: ReviewPolicyVersionRef;
  readonly policies: readonly PolicyView[];
}

interface ProjectRow {
  readonly project_id: string;
  readonly team_id: string;
  readonly name: string;
  readonly revision: number;
  readonly default_policy_id: string | null;
  readonly default_policy_version: number | null;
}

interface MembershipRow {
  readonly user_id: string;
  readonly display_name: string;
  readonly roles_json: string;
  readonly revision: number;
}

function parseRoles(raw: string): readonly string[] {
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.some((role) => typeof role !== 'string' || role.length === 0)
  ) {
    throw new Error('저장된 가상 사용자 역할이 올바르지 않습니다.');
  }
  return value;
}

export function readWorkspace(
  db: DatabaseConnection,
  projectId: string,
): StoredWorkspace | undefined {
  const project = db
    .prepare(
      `SELECT project_id, team_id, name, revision, default_policy_id, default_policy_version
         FROM workspace_projects WHERE project_id=?`,
    )
    .get(projectId) as ProjectRow | undefined;
  if (project === undefined) return undefined;

  const memberships = db
    .prepare(
      `SELECT user_id, display_name, roles_json, revision
         FROM demo_user_memberships
        WHERE project_id=? AND demo=1
        ORDER BY user_id`,
    )
    .all(projectId) as MembershipRow[];

  return {
    project: {
      projectId: project.project_id,
      teamId: project.team_id,
      name: project.name,
      revision: project.revision,
    },
    memberships: memberships.map((membership) => ({
      actorId: membership.user_id,
      displayName: membership.display_name,
      roles: parseRoles(membership.roles_json),
      revision: membership.revision,
    })),
    ...(project.default_policy_id === null || project.default_policy_version === null ? {} : {
      defaultPolicyRef: {
        kind: 'review_policy' as const,
        projectId: project.project_id,
        entityId: project.default_policy_id,
        version: project.default_policy_version,
      },
    }),
    policies: readPolicies(db, projectId),
  };
}
