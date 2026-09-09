import type { BundleRef } from '@/src/contracts/context';
import type { SRDetailView } from '@/src/contracts/views';
import {
  currentPlan, isInceptionPlan, planState, type PlanState,
} from '../state/inception-plan';
import { ReviewSummary } from './ReviewSummary';
import type { PlanReadinessIssue } from '../state/plan-review-readiness';

const STATE_LABELS: Record<PlanState, string> = {
  draft: '초안',
  aligning: '내용 정리 중',
  review: '검토·결재 중',
  changes: '수정 필요',
  approved: '결재 완료',
};

function sameBundle(left: BundleRef | undefined, right: BundleRef | undefined): boolean {
  return left !== undefined && right !== undefined && left.projectId === right.projectId && left.srId === right.srId &&
    left.gate === right.gate && left.bundleId === right.bundleId && left.version === right.version;
}

export function PlanApproval({ actorId, projectId, detail, actorName, onResolveIssue, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly actorName: (id: string) => string;
  readonly onResolveIssue?: (issue: PlanReadinessIssue) => void;
  onSaved(): void;
}) {
  const plan = currentPlan(detail);
  const inceptionPlan = isInceptionPlan(plan);
  const state = planState(detail);
  const configuration = detail.reviewConfigurations.find((item) => item.gate === 'G1');
  const bundle = detail.bundles.find((item) => sameBundle(item.bundleRef, configuration?.currentBundleRef) &&
    item.reviewEpoch === configuration?.reviewEpoch);
  const approvedPlanVersion = plan !== undefined && configuration?.validity === 'valid' && configuration.needsNewBundle === false &&
    bundle?.artifactVersionRefs.length === 1 && bundle.artifactVersionRefs[0]?.entityId === plan.artifactId &&
    bundle.artifactVersionRefs[0].version === plan.versionRef.version;
  const visibleState = state === 'approved' && !approvedPlanVersion ? '현재 버전 확인 필요' : STATE_LABELS[state];

  if (plan === undefined) {
    return <section className="entity-panel plan-approval" aria-label="Plan 결재">
      <p className="eyebrow">Inception Plan</p><h2>Plan 결재</h2>
      <p>결재할 Plan이 아직 없습니다. 먼저 Plan 문서를 작성해 주세요.</p>
    </section>;
  }

  if (!inceptionPlan) {
    return <section className="plan-approval" aria-label="기존 요구사항 검토">
      <div className="entity-panel"><p className="eyebrow">기존 요구사항 문서</p><h2>요구사항 검토</h2>
        <p>문서 v{plan.versionRef.version}은 기존 요구사항 문서입니다. 이 문서의 승인은 Inception Plan 전체 결재와 구분해 기록합니다.</p></div>
      <p className="quiet">기존 요구사항 검토 상태: {configuration?.validity === 'valid' ? '검토 통과' : '검토 전 또는 재검토 필요'}. 문서에서 본문을 확인하고 현재 버전을 함께 검토할 수 있습니다.</p>
      <ReviewSummary actorId={actorId} projectId={projectId} detail={detail} actorName={actorName} gate="G1" displayLabel="요구사항" showReadiness {...(onResolveIssue === undefined ? {} : { onResolveIssue })} onSaved={onSaved} />
    </section>;
  }

  if (approvedPlanVersion) {
    const approvers = detail.approvals.filter((approval) => sameBundle(approval.bundleRef, bundle?.bundleRef) && approval.reviewEpoch === bundle?.reviewEpoch);
    return <section className="entity-panel plan-approval" aria-label="Plan 결재 완료">
      <p className="eyebrow">Inception Plan</p><h2>Plan 결재 완료</h2>
      <p className="success-note">Plan 문서 v{plan.versionRef.version}의 결재가 완료됐습니다.</p>
      <p>이 결재로 확정한 범위는 현재 Inception Plan의 문서 내용입니다. 문서에 연결된 시각화도 같은 버전으로 보관합니다.</p>
      {plan.sectionIndex.length > 0 && <ul>{plan.sectionIndex.map((section) => <li key={section.sectionId}>{section.title}</li>)}</ul>}
      <p>승인한 검토자: {approvers.length === 0 ? '승인 기록 확인 완료' : approvers.map((item) => actorName(item.approverId)).join(', ')}</p>
      {approvers.map(item => <article className="answer-record" key={item.approvalId}><strong>{actorName(item.approverId)}</strong><p>{item.comment ?? '현재 Plan을 확인하고 승인했습니다.'}</p><time dateTime={item.approvedAt}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.approvedAt))}</time></article>)}
    </section>;
  }

  return <section className="plan-approval" aria-label="Plan 검토와 결재">
    <div className="entity-panel"><p className="eyebrow">Inception Plan</p><h2>Plan 검토와 결재</h2>
      <p>Plan 문서 v{plan.versionRef.version} · {visibleState}</p>
      <p>지정 검토자가 같은 Plan 버전을 확인하고 모두 승인하면 담당자가 결재를 완료합니다.</p></div>
    <ReviewSummary actorId={actorId} projectId={projectId} detail={detail} actorName={actorName} gate="G1" displayLabel="문서" planMode {...(onResolveIssue === undefined ? {} : { onResolveIssue })} onSaved={onSaved} />
  </section>;
}
