import { useEffect, useMemo, useRef, useState } from 'react';
import type { BundleGuard, BundleRef } from '@/src/contracts/context';
import type { ApprovalInput, ApprovalView, ReviewBundleSnapshot, SRDetailView } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import { SafeMarkdown } from './SafeMarkdown';

function sameBundle(left: BundleRef | undefined, right: BundleRef | undefined): boolean {
  return left !== undefined && right !== undefined && left.projectId === right.projectId && left.srId === right.srId &&
    left.gate === right.gate && left.bundleId === right.bundleId && left.version === right.version;
}

function localError(error: unknown) {
  return { code: 'STORE_UNAVAILABLE' as const, message: error instanceof Error ? error.message : '승인을 기록하지 못했습니다.', blockers: [], assigneeIds: [], targetRefs: [] };
}

export function BundleReviewForm({ actorId, projectId, detail, bundle, actorName, displayLabel, planMode = false, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly bundle: ReviewBundleSnapshot;
  readonly actorName: (id: string) => string;
  readonly displayLabel?: string;
  readonly planMode?: boolean;
  onSaved(): void;
}) {
  const label = displayLabel ?? (bundle.bundleRef.gate === 'G1' ? '요구사항' : '계획');
  const srId = detail.sr.scope.srId;
  const target = `${bundle.bundleRef.gate}:${bundle.bundleRef.bundleId}:${bundle.bundleRef.version}`;
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, target]);
  const mounted = useRef(true);
  const [checked, setChecked] = useState<readonly string[]>([]);
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const alreadyApproved = detail.approvals.some((approval) => sameBundle(approval.bundleRef, bundle.bundleRef) && approval.reviewEpoch === bundle.reviewEpoch && approval.approverId === actorId);
  const assigned = bundle.reviewerIds.includes(actorId);

  const execute = async (attempt: CommandAttempt<ApprovalInput, BundleGuard>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const response = await invoke('M-021', { actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey }, attempt.submission.input);
      if (!mounted.current) return;
      const resolved = session.resolve(attempt, asCommandResult(response), { actorId, scope: { kind: 'sr', projectId, srId }, target, command: 'M-021' });
      if (!resolved.appliesToCurrentForm) return;
      if (resolved.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolved.result.error });
        return;
      }
      const value: ApprovalView = resolved.result.value;
      setFeedback(resolved.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 기록한 개별 승인을 확인했습니다.', receiptId: resolved.result.priorReceipt.receiptId }
        : { kind: 'committed', message: `${actorName(value.approverId)}님의 개별 승인을 기록했습니다.` });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error) });
    } finally { session.endExecution(attempt); }
  };

  const approve = () => {
    if (checked.length !== bundle.checklistSnapshot.length) {
      setFeedback({ kind: 'rejected', error: { code: 'VALIDATION_ERROR', message: '모든 확인 항목을 살펴보고 체크해 주세요.', blockers: [], assigneeIds: [], targetRefs: [] } });
      return;
    }
    const [first, ...rest] = bundle.checklistSnapshot;
    const checklistResults: ApprovalInput['checklistResults'] = [
      { itemId: first.itemId, checked: true },
      ...rest.map((item) => ({ itemId: item.itemId, checked: true as const })),
    ];
    const input: ApprovalInput = {
      bundleRef: bundle.bundleRef, reviewEpoch: bundle.reviewEpoch, approvalScope: bundle.bundleRef.gate,
      checklistResults,
      ...(comment.trim() === '' ? {} : { comment }),
    };
    const guard: BundleGuard = { expectedBundleRef: bundle.bundleRef, expectedReviewEpoch: bundle.reviewEpoch };
    void execute(session.submit({ actorId, scope: { kind: 'sr', projectId, srId }, target, command: 'M-021', input, guard }));
  };

  const artifacts = bundle.artifactVersionRefs.map((ref) => detail.artifacts.find((item) => item.versionRef.entityId === ref.entityId && item.versionRef.version === ref.version));
  const questions = bundle.questionResultRefs.map((ref) => detail.questions.find((item) => item.currentResult.ref.entityId === ref.entityId && item.currentResult.ref.version === ref.version));
  const decisions = bundle.decisionVersionRefs.map((ref) => detail.decisions.find((item) => item.currentConfirmation?.ref.entityId === ref.entityId && item.currentConfirmation.ref.version === ref.version));
  const requirementsArtifactId = detail.artifacts.find((item) => item.kind === 'requirements')?.artifactId;
  const planArtifactRef = planMode || displayLabel === 'Plan'
    ? bundle.artifactVersionRefs.find((ref) => ref.entityId === requirementsArtifactId)
      ?? (bundle.artifactVersionRefs.length === 1 ? bundle.artifactVersionRefs[0] : undefined)
    : undefined;
  const reviewTitle = planArtifactRef === undefined ? `${label} 검토본 v${bundle.bundleRef.version}` : `${label} v${planArtifactRef.version}`;

  return <section className="bundle-review" aria-label={`${label} 검토본 확인`}>
    <p className="eyebrow">지정 검토자 확인</p>
    <h3>{reviewTitle}</h3>
    <p>아래 내용은 검토 요청 당시 고정됐습니다. 현재 화면의 미해결 항목과 별개로 이 검토본을 확인할 수 있습니다.</p>
    <div className="frozen-review-content">
      {artifacts.map((artifact, index) => artifact === undefined
        ? <p key={`artifact-${index}`}>고정된 문서 본문을 현재 조회에서 확인할 수 없습니다.</p>
        : <article key={artifact.artifactId}><h4>{artifact.sectionIndex[0]?.title ?? '검토 문서'}</h4><SafeMarkdown>{artifact.markdown}</SafeMarkdown></article>)}
      {questions.map((question, index) => question === undefined
        ? <p key={`question-${index}`}>고정된 질문 결과를 현재 조회에서 확인할 수 없습니다.</p>
        : <article key={question.questionId}><h4>{question.text}</h4><p>{question.currentResult.selectedAnswer?.answer.text ?? '미해결 질문'}</p></article>)}
      {decisions.map((decision, index) => decision === undefined
        ? <p key={`decision-${index}`}>고정된 결정 내용을 현재 조회에서 확인할 수 없습니다.</p>
        : <article key={decision.decisionId}><h4>{decision.prompt}</h4><p>{decision.currentConfirmation?.selection.text}</p><p>{decision.currentConfirmation?.rationale}</p></article>)}
      {bundle.unconfirmedDecisionSnapshots.map((decision) => <article key={decision.decisionId}><h4>{decision.prompt}</h4><p>아직 확정되지 않은 결정입니다.</p><ul>{decision.alternatives.map((item) => <li key={item.optionId}>{item.label}</li>)}</ul></article>)}
    </div>
    {planMode && <p className="quiet">현재 문서에 적힌 내용으로 확인합니다. 별도 근거 문서를 작성하지 않아도 됩니다.</p>}
    {assigned && !alreadyApproved ? <><fieldset><legend>검토 확인 항목</legend>
      {bundle.checklistSnapshot.map((item) => <label className="checkbox-label" key={item.itemId}>
        <input type="checkbox" aria-label={item.label} checked={checked.includes(item.itemId)} disabled={alreadyApproved}
          onChange={(event) => setChecked(event.target.checked ? [...checked, item.itemId] : checked.filter((id) => id !== item.itemId))} />
        {item.label}
      </label>)}
    </fieldset>
    <label>승인 의견<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label></> : <div><h4>검토 확인 항목</h4><ul>{bundle.checklistSnapshot.map(item => <li key={item.itemId}>{item.label}</li>)}</ul></div>}
    {alreadyApproved ? <p className="success-note">이 검토본에 대한 개별 승인이 기록됐습니다.</p>
      : assigned ? <button type="button" className="primary-button" onClick={approve}>{planMode ? '현재 문서 승인' : `${reviewTitle} 승인`}</button>
        : <p className="quiet">현재 지정 검토자만 개별 승인할 수 있습니다.</p>}
    <CommandFeedback state={feedback} />
  </section>;
}
