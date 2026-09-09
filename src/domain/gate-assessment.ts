import type { BundleRef, EntityRef, GateKind, ReviewAssignmentRef, ReviewPolicyVersionRef } from '@/src/contracts/context';
import type { GateAssessment, GateConditionResult } from '@/src/contracts/results';
import { reviewState } from './review-state';

export interface GateAssessmentQuestion {
  readonly questionId: string;
  readonly requiredGate: GateKind;
  readonly assigneeId: string;
  readonly status: 'open' | 'answered' | 'resolved' | 'converted_to_decision';
  readonly convertedDecisionLinked: boolean;
}

export interface GateAssessmentDecision {
  readonly decisionId: string;
  readonly requiredGate: GateKind;
  readonly decisionMakerId: string;
  readonly confirmed: boolean;
}

export interface GateAssessmentApproval {
  readonly approvalId: string;
  readonly approverId: string;
  readonly checklistItemIds: readonly string[];
}

export interface GateAssessmentInput {
  readonly projectId: string;
  readonly srId: string;
  readonly ownerId: string;
  readonly assessedRevision: number;
  readonly gate: GateKind;
  readonly reviewEpoch: number;
  readonly needsNewBundle: boolean;
  readonly documentReviewMode?: boolean;
  readonly currentBundleRef?: BundleRef;
  readonly bundle?: {
    readonly ref: BundleRef;
    readonly reviewEpoch: number;
    readonly assignmentRef: ReviewAssignmentRef;
    readonly policyRef: ReviewPolicyVersionRef;
    readonly artifactKinds: readonly string[];
    readonly requirementsNonempty?: boolean;
    readonly requirementsStructured: boolean;
    readonly basisCurrent: boolean;
    readonly g1BundleRef?: BundleRef<'G1'>;
  };
  readonly assignment?: {
    readonly ref: ReviewAssignmentRef;
    readonly reviewerIds: readonly string[];
  };
  readonly policy?: {
    readonly ref: ReviewPolicyVersionRef;
    readonly requiredRoles: readonly string[];
    readonly checklistItemIds: readonly string[];
  };
  readonly reviewerRoles: Readonly<Record<string, readonly string[]>>;
  readonly approvals: readonly GateAssessmentApproval[];
  readonly questions: readonly GateAssessmentQuestion[];
  readonly decisions: readonly GateAssessmentDecision[];
  readonly blockingChanges: readonly { readonly changeRequestId: string; readonly assigneeId: string }[];
  readonly g1?: { readonly valid: boolean; readonly currentBundleRef?: BundleRef<'G1'> };
}

function entity(input: GateAssessmentInput, kind: EntityRef['kind'], entityId: string): EntityRef {
  return { kind, projectId: input.projectId, srId: input.srId, entityId } as EntityRef;
}

function condition(
  conditionId: string,
  passed: boolean,
  reason: string,
  assigneeIds: readonly string[] = [],
  targetRefs: readonly EntityRef[] = [],
): GateConditionResult {
  return { conditionId, passed, reason, assigneeIds, targetRefs };
}

function sameBundle(left: BundleRef | undefined, right: BundleRef | undefined): boolean {
  return left !== undefined && right !== undefined && left.projectId === right.projectId && left.srId === right.srId &&
    left.gate === right.gate && left.bundleId === right.bundleId && left.version === right.version;
}

export function assessGate(input: GateAssessmentInput): GateAssessment {
  const bundleCurrent = input.bundle !== undefined && input.bundle.basisCurrent && sameBundle(input.currentBundleRef, input.bundle.ref) &&
    input.bundle.reviewEpoch === input.reviewEpoch && !input.needsNewBundle &&
    input.assignment !== undefined && input.policy !== undefined &&
    input.bundle.assignmentRef.entityId === input.assignment.ref.entityId && input.bundle.assignmentRef.version === input.assignment.ref.version &&
    input.bundle.policyRef.entityId === input.policy.ref.entityId && input.bundle.policyRef.version === input.policy.ref.version;
  const requiredKinds = input.gate === 'G1'
    ? ['requirements']
    : ['requirements', 'workflow_plan', 'design', 'implementation_plan'];
  const missingKinds = requiredKinds.filter((kind) => input.bundle?.artifactKinds.includes(kind) !== true);
  const requirementsIncluded = input.bundle?.artifactKinds.includes('requirements') === true;
  const requirementsStructured = input.bundle?.requirementsStructured === true;
  const documentReviewMode = input.gate === 'G1' && input.documentReviewMode === true;
  const requirementsNonempty = input.bundle?.requirementsNonempty === true;
  const documentsReady = missingKinds.length === 0 &&
    (documentReviewMode ? requirementsNonempty : requirementsStructured);
  const documentKindLabels: Readonly<Record<string, string>> = {
    requirements: '요구사항', workflow_plan: '진행 계획', design: '설계', implementation_plan: '구현 계획',
  };
  const documentFailureReasons = [
    ...(missingKinds.length === 0 ? [] : [`검토 요청에 ${missingKinds.map((kind) => documentKindLabels[kind]).join(', ')} 문서를 포함해 주세요.`]),
    ...(requirementsIncluded && !requirementsStructured && !documentReviewMode
      ? ['검토 요청에 포함된 요구사항 문서의 항목과 완료 기준을 보완해 주세요.']
      : []),
    ...(documentReviewMode && !requirementsNonempty
      ? ['비어 있지 않은 요구사항 문서를 준비해 주세요.']
      : []),
  ];
  const questionFailures = input.questions.filter((question) =>
    question.status === 'converted_to_decision' ? !question.convertedDecisionLinked : question.status !== 'resolved');
  const decisionFailures = input.decisions.filter((decision) => !decision.confirmed);
  const reviewers = input.assignment?.reviewerIds ?? [];
  const distinctPeer = reviewers.length > 0 && reviewers.some((id) => id !== input.ownerId);
  const approvalBy = new Map(input.approvals.map((approval) => [approval.approverId, approval]));
  const allApproved = reviewers.length > 0 && reviewers.every((id) => approvalBy.has(id));
  const checklistComplete = input.policy !== undefined && allApproved && reviewers.every((id) => {
    const checked = approvalBy.get(id)?.checklistItemIds ?? [];
    return checked.length === input.policy?.checklistItemIds.length && input.policy.checklistItemIds.every((item) => checked.includes(item));
  });
  const roleSet = new Set(reviewers.flatMap((id) => input.reviewerRoles[id] ?? []));
  const rolesReady = input.policy !== undefined && input.policy.requiredRoles.every((role) => roleSet.has(role));
  const g1Valid = input.g1?.valid === true;
  const g1BundleMatches = g1Valid && sameBundle(input.bundle?.g1BundleRef, input.g1?.currentBundleRef);
  const g1Ready = input.gate === 'G1' || g1BundleMatches;
  const bundleFailureReason = input.bundle === undefined || input.currentBundleRef === undefined
    ? '검토할 자료를 준비한 뒤 검토를 요청해 주세요.'
    : '검토 기준이 바뀌었습니다. 최신 내용으로 검토를 다시 요청해 주세요.';
  const approvalFailureReason = reviewers.length === 0
    ? '검토자를 먼저 배정해 주세요.'
    : '아직 승인하지 않은 검토자가 있습니다.';
  const policyFailureReason = input.policy === undefined
    ? '검토 정책을 먼저 설정해 주세요.'
    : reviewers.length === 0
      ? '정책 기준을 충족할 검토자를 먼저 배정해 주세요.'
      : !rolesReady
        ? '정책에 필요한 역할을 가진 검토자를 배정해 주세요.'
        : '아직 체크리스트 확인이 끝나지 않았습니다.';
  const g1FailureReason = g1Valid
    ? '최신 요구사항을 반영해 계획 검토를 다시 요청해 주세요.'
    : '요구사항 검토를 먼저 완료해 주세요.';
  const conditions = [
    condition('GP-01', bundleCurrent, bundleCurrent ? '현재 검토 자료와 검토자 기준이 일치합니다.' : bundleFailureReason, [input.ownerId], [entity(input, 'review_gate_state', input.gate)]),
    condition('GP-02', documentsReady, documentsReady
      ? documentReviewMode
        ? '현재 요구사항 문서가 준비됐습니다. 문서 구조는 검토 조건으로 강제하지 않습니다.'
        : '검토에 필요한 문서와 요구사항 구조가 준비됐습니다.'
      : documentFailureReasons.join(' '), [input.ownerId]),
    condition('GP-03', documentReviewMode || questionFailures.length === 0,
      documentReviewMode
        ? `미해결 질문 ${questionFailures.length}개는 참고용 기록이며 문서 검토와 분리합니다.`
        : questionFailures.length === 0 ? '필수 질문이 해결됐습니다.' : '현재 필수 질문의 해결이 필요합니다.',
      documentReviewMode ? [] : [...new Set(questionFailures.map((item) => item.status === 'open' ? item.assigneeId : input.ownerId))],
      questionFailures.map((item) => entity(input, 'question', item.questionId))),
    condition('GP-04', documentReviewMode || decisionFailures.length === 0,
      documentReviewMode
        ? `미확정 결정 ${decisionFailures.length}개는 참고용 기록이며 문서 검토와 분리합니다.`
        : decisionFailures.length === 0 ? '필수 결정이 확정됐습니다.' : '현재 필수 결정의 확정이 필요합니다.',
      documentReviewMode ? [] : decisionFailures.map((item) => item.decisionMakerId),
      decisionFailures.map((item) => entity(input, 'decision', item.decisionId))),
    condition('GP-05', input.blockingChanges.length === 0, input.blockingChanges.length === 0 ? '먼저 해결해야 할 수정 요청이 없습니다.' : '다음 단계로 진행하려면 남은 수정 요청을 해결하고 확인을 받아야 합니다.', input.blockingChanges.map((item) => item.assigneeId), input.blockingChanges.map((item) => entity(input, 'change_request', item.changeRequestId))),
    condition('GP-06', distinctPeer, distinctPeer ? '담당자 외 동료 검토자가 있습니다.' : '검토자를 한 명 이상 배정하고 SR 담당자 외 동료 검토자를 포함해 주세요.', [input.ownerId]),
    condition('GP-07', allApproved, allApproved ? '검토자 전원이 승인했습니다.' : approvalFailureReason, reviewers.filter((id) => !approvalBy.has(id)), [entity(input, 'review_bundle', input.currentBundleRef?.bundleId ?? input.gate)]),
    condition('GP-08', rolesReady && checklistComplete, rolesReady && checklistComplete ? '정책 역할과 체크리스트를 충족했습니다.' : policyFailureReason, reviewers),
    condition('GP-09', g1Ready, input.gate === 'G1' ? '요구사항 검토는 먼저 완료해야 할 다른 검토가 없습니다.' : g1Ready ? '현재 요구사항 검토 묶음이 계획 검토와 일치합니다.' : g1FailureReason, [input.ownerId], [entity(input, 'review_gate_state', 'G1')]),
  ];
  return {
    gate: input.gate,
    assessedRevision: input.assessedRevision,
    reviewEpoch: input.reviewEpoch,
    ...(input.currentBundleRef === undefined ? {} : { currentBundleRef: input.currentBundleRef }),
    ...(input.bundle?.g1BundleRef === undefined ? {} : { g1BundleRef: input.bundle.g1BundleRef }),
    conditions,
    reviewState: reviewState({
      needsNewBundle: input.needsNewBundle,
      hasCurrentBundle: input.bundle !== undefined,
      hasBlockingChange: input.blockingChanges.length > 0,
      reviewerCount: reviewers.length,
      approvedReviewerCount: reviewers.filter((id) => approvalBy.has(id)).length,
      hasReviewAction: input.approvals.length > 0,
    }),
    canTransition: conditions.every((item) => item.passed),
  };
}
