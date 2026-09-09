import type { BundleRef } from '@/src/contracts/context';
import type { SRDetailView } from '@/src/contracts/views';
import { BundleReviewForm } from './BundleReviewForm';
import { GateConditionPanel } from './GateConditionPanel';
import { ReviewRequestForm, type ReviewRequestAvailability } from './ReviewRequestForm';
import { g1PlanReadiness, type PlanReadinessIssue } from '../state/plan-review-readiness';
import './PlanReadiness.css';

function sameBundle(left: BundleRef | undefined, right: BundleRef | undefined): boolean {
  return left !== undefined && right !== undefined && left.projectId === right.projectId && left.srId === right.srId &&
    left.gate === right.gate && left.bundleId === right.bundleId && left.version === right.version;
}

export function ReviewSummary({ actorId, projectId, detail, actorName, gate = 'G1', displayLabel, planMode = false, showReadiness = planMode, onResolveIssue, onSaved }: {
  readonly gate?: 'G1' | 'G2';
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly actorName: (id: string) => string;
  readonly displayLabel?: string;
  readonly planMode?: boolean;
  readonly showReadiness?: boolean;
  readonly onResolveIssue?: (issue: PlanReadinessIssue) => void;
  onSaved(): void;
}) {
  const label = displayLabel ?? (gate === 'G1' ? '요구사항' : '계획');
  const config = detail.reviewConfigurations.find((item) => item.gate === gate);
  const preparation = detail.reviewPreparations.find((item) => item.gate === gate);
  const assessment = detail.gateAssessments.find((item) => item.gate === gate);
  if (config === undefined || preparation === undefined || assessment === undefined) return <section className="entity-panel"><p>{label} 검토 상태를 불러오지 못했습니다.</p></section>;
  const bundle = detail.bundles.find((item) => sameBundle(item.bundleRef, config.currentBundleRef) && item.reviewEpoch === config.reviewEpoch);
  const currentApprovals = bundle === undefined ? [] : detail.approvals.filter((item) => sameBundle(item.bundleRef, bundle.bundleRef) && item.reviewEpoch === bundle.reviewEpoch);
  const currentRequests = bundle === undefined ? [] : detail.reviewRequests.filter((item) => sameBundle(item.bundleRef, bundle.bundleRef) && item.reviewEpoch === bundle.reviewEpoch);
  const assignedNames = config.assignment?.reviewerIds.map(actorName) ?? [];
  const approvedNames = currentApprovals.map((item) => actorName(item.approverId));
  const allReviewersApproved = bundle !== undefined && bundle.reviewerIds.length > 0 &&
    bundle.reviewerIds.every((id) => currentApprovals.some((approval) => approval.approverId === id));
  const readinessIssues = gate === 'G1' && showReadiness ? g1PlanReadiness(detail) : [];
  const requestAvailability: ReviewRequestAvailability = config.validity === 'valid' && !config.needsNewBundle
    ? 'complete'
    : !config.needsNewBundle && allReviewersApproved
      ? 'approved'
    : !config.needsNewBundle && currentRequests.some((item) => item.status === 'pending')
      ? 'pending'
      : readinessIssues.length > 0
        ? 'blocked'
      : 'available';
  const currentStatus = assignedNames.length === 0
    ? '검토자 배정이 필요합니다.'
    : config.validity === 'valid'
      ? `${label} 검토 통과`
      : config.needsNewBundle
        ? '현재 자료로 다시 검토해야 합니다.'
        : allReviewersApproved && !assessment.canTransition
          ? '검토자 승인 완료 · 추가 확인 필요'
          : assessment.reviewState;

  return <section className="entity-panel official-review" aria-label={`${label} 공식 검토`}>
    <p className="eyebrow">{label} 검토</p><h2>{label} 검토</h2>
    <div className="review-progress">
      <div><strong>지정 검토자</strong><span>{assignedNames.length === 0 ? '검토자 배정이 필요합니다.' : assignedNames.join(', ')}</span></div>
      <div><strong>검토 요청</strong><span>{assignedNames.length === 0 ? '배정 후 요청할 수 있습니다.' : `${currentRequests.filter((item) => item.status === 'pending').length}명이 확인할 차례입니다.`}</span></div>
      <div><strong>개별 승인</strong><span>{assignedNames.length === 0 ? '검토자 배정 후 집계됩니다.' : `${approvedNames.length}/${assignedNames.length}명 승인`}</span></div>
      <div><strong>현재 상태</strong><span>{currentStatus}</span></div>
    </div>
    {readinessIssues.length > 0 && <section className="plan-readiness" aria-label="검토 전에 확인할 내용">
      <div><p className="eyebrow">다음 행동</p><h3>{allReviewersApproved ? '검토자 승인은 끝났고, 아래 내용을 더 확인해야 합니다.' : '검토 요청 전에 아래 내용을 확인해 주세요.'}</h3></div>
      <ul>{readinessIssues.map((issue) => <li key={issue.id}><div><strong>{issue.title}</strong><p>{issue.detail}</p>
        {issue.assigneeIds.length > 0 && <small>확인할 사람: {issue.assigneeIds.map(actorName).join(', ')}</small>}</div>
        {onResolveIssue !== undefined && <button type="button" onClick={() => onResolveIssue(issue)}>{issue.actionLabel}</button>}</li>)}</ul>
    </section>}
    <ReviewRequestForm actorId={actorId} projectId={projectId} srId={detail.sr.scope.srId} ownerId={detail.sr.ownerId} detail={detail} configuration={config} preparation={preparation} availability={requestAvailability} displayLabel={label} canTransition={assessment.canTransition} onSaved={onSaved} />
    {bundle !== undefined && !config.needsNewBundle && <BundleReviewForm key={`${bundle.bundleRef.bundleId}:${bundle.bundleRef.version}`} actorId={actorId} projectId={projectId} detail={detail} bundle={bundle} actorName={actorName} displayLabel={label} planMode={planMode} onSaved={onSaved} />}
    {bundle !== undefined && config.needsNewBundle && <section className="stale-review-bundle"><h3>이전 검토본은 현재 Plan 승인에 사용할 수 없습니다.</h3><p>위 확인 내용을 해결한 뒤 현재 Plan 버전으로 다시 검토를 요청해 주세요.</p></section>}
    <GateConditionPanel actorId={actorId} projectId={projectId} sr={detail.sr} initial={assessment} actorName={actorName} displayLabel={label} planMode={planMode} onSaved={onSaved} />
  </section>;
}
