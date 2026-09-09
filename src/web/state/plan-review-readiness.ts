import type { SRDetailView } from '@/src/contracts/views';

export type PlanReadinessAction = 'documents' | 'assignment';

export interface PlanReadinessIssue {
  readonly id: string;
  readonly kind: 'change' | 'document' | 'reviewers';
  readonly title: string;
  readonly detail: string;
  readonly assigneeIds: readonly string[];
  readonly action: PlanReadinessAction;
  readonly actionLabel: string;
  readonly targetId?: string;
}

export function g1PlanReadiness(detail: SRDetailView): readonly PlanReadinessIssue[] {
  const issues: PlanReadinessIssue[] = [];
  for (const request of detail.changeRequests) {
    if (!request.blocking || request.affectedGate !== 'G1' || request.status === 'resolved') continue;
    issues.push({
      id: `change:${request.changeRequestId}`,
      kind: 'change',
      title: request.body,
      detail: request.status === 'open' ? 'Plan 문서를 수정하고 검토자에게 확인을 요청해야 합니다.' : '수정 결과를 검토자가 확인해야 합니다.',
      assigneeIds: [request.status === 'open' ? request.assigneeId : request.requesterId],
      action: 'documents',
      actionLabel: '문서 리뷰에서 해결',
      targetId: request.originalSectionId,
    });
  }

  const configuration = detail.reviewConfigurations.find((item) => item.gate === 'G1');
  const preparation = detail.reviewPreparations.find((item) => item.gate === 'G1');
  const currentPlan = detail.artifacts.find((item) => item.kind === 'requirements');
  if (currentPlan === undefined || currentPlan.markdown.trim() === '') {
    issues.push({ id: 'document:requirements', kind: 'document', title: '검토할 Plan 문서가 없습니다.',
      detail: '등록한 초안을 Plan 문서로 정리해 주세요.', assigneeIds: [detail.sr.ownerId], action: 'documents', actionLabel: 'Plan 문서 준비' });
  }
  if (configuration?.assignment === undefined || configuration.assignment.reviewerIds.length === 0 || !configuration.assignment.ready) {
    issues.push({ id: 'reviewers:G1', kind: 'reviewers', title: 'Plan 검토자를 준비해 주세요.',
      detail: configuration?.assignment?.notReadyReason ?? '현재 Plan을 함께 확인할 동료를 지정해야 합니다.', assigneeIds: [detail.sr.ownerId], action: 'assignment', actionLabel: '검토자 지정' });
  }
  if (currentPlan !== undefined && preparation?.kind === 'NeedsInputs' && preparation.missing.some((item) => /artifact|requirements|document/u.test(item))) {
    issues.push({ id: 'document:preparation', kind: 'document', title: '현재 Plan 문서를 검토본으로 준비하지 못했습니다.',
      detail: 'Plan 문서의 필수 내용과 구조를 확인해 주세요.', assigneeIds: preparation.assigneeIds.length > 0 ? preparation.assigneeIds : [detail.sr.ownerId],
      action: 'documents', actionLabel: 'Plan 문서 확인' });
  }
  return issues;
}
