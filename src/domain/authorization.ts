import type { DomainError } from '@/src/contracts/results';

export interface AuthorizationMembership {
  readonly actorId: string;
}

function error(
  code: Extract<DomainError['code'], 'FORBIDDEN' | 'NOT_ASSIGNED' | 'NOT_FOUND'>,
  message: string,
): DomainError {
  return { code, message, blockers: [], assigneeIds: [], targetRefs: [] };
}

export function requireProjectMember(
  actorId: string,
  membership: AuthorizationMembership | undefined,
): DomainError | undefined {
  return membership?.actorId === actorId
    ? undefined
    : error('FORBIDDEN', '현재 프로젝트 멤버만 이 작업을 할 수 있습니다.');
}

export function requireMemberOwner(
  ownerId: string,
  membership: AuthorizationMembership | undefined,
): DomainError | undefined {
  return membership?.actorId === ownerId
    ? undefined
    : error('NOT_FOUND', '지정한 담당자가 현재 프로젝트 멤버가 아닙니다.');
}

export function requireSrOwner(actorId: string, ownerId: string): DomainError | undefined {
  return actorId === ownerId
    ? undefined
    : error('NOT_ASSIGNED', '현재 SR 담당자만 이 작업을 할 수 있습니다.');
}
