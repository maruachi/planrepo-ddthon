import type { GateKind } from '@/src/contracts/context';
import type { GatePolicy, PolicyEdit } from '@/src/contracts/views';

export interface ReviewMembership {
  readonly actorId: string;
  readonly roles: readonly string[];
}

function filled(value: string): boolean {
  return value.trim().length > 0;
}

export function validatePolicyEdit(input: PolicyEdit): string | undefined {
  if (!input.requireAllAssigned || !input.requireDistinctPeer) {
    return '필수 검토 정책을 완화할 수 없습니다.';
  }
  const itemIds: string[] = [];
  for (const gate of ['G1', 'G2'] as const) {
    const policy = input.gates[gate];
    if (policy.requiredRoles.length === 0 || policy.requiredRoles.some((role) => !filled(role))) {
      return `${gate} 필수 역할이 올바르지 않습니다.`;
    }
    if (new Set(policy.requiredRoles).size !== policy.requiredRoles.length) {
      return `${gate} 필수 역할이 중복됐습니다.`;
    }
    if (policy.checklist.length === 0 || policy.checklist.some((item) => !filled(item.itemId) || !filled(item.label))) {
      return `${gate} 체크리스트가 올바르지 않습니다.`;
    }
    itemIds.push(...policy.checklist.map((item) => item.itemId));
  }
  if (new Set(itemIds).size !== itemIds.length) return '정책의 checklist itemId가 중복됐습니다.';
  if ('previousPolicyRef' in input && (input.changeReason === undefined || !filled(input.changeReason))) return '정책 변경 이유가 비었습니다.';
  return undefined;
}

export function assessReviewerAssignment(
  reviewerIds: readonly string[],
  ownerId: string,
  memberships: readonly ReviewMembership[],
  policy: GatePolicy,
): { readonly ready: boolean; readonly reason?: string } {
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    return { ready: false, reason: '검토자가 중복됐습니다.' };
  }
  const reviewers = reviewerIds.map((id) => memberships.find((member) => member.actorId === id));
  if (reviewers.some((member) => member === undefined)) {
    return { ready: false, reason: '현재 프로젝트 멤버가 아닌 검토자가 있습니다.' };
  }
  if (reviewerIds.length === 0) return { ready: false, reason: '검토자를 한 명 이상 배정해야 합니다.' };
  if (!reviewerIds.some((id) => id !== ownerId)) {
    return { ready: false, reason: 'SR 담당자 외 동료 검토자가 필요합니다.' };
  }
  const roles = new Set(reviewers.flatMap((member) => member?.roles ?? []));
  const missing = policy.requiredRoles.filter((role) => !roles.has(role));
  return missing.length === 0
    ? { ready: true }
    : { ready: false, reason: `필수 역할이 부족합니다: ${missing.join(', ')}` };
}

export function affectedReviewGates(gates: readonly GateKind[]): readonly GateKind[] {
  return gates.includes('G1') ? ['G1', 'G2'] : ['G2'];
}
