import { useEffect, useMemo, useRef, useState } from 'react';
import type { RevisionAndBundleGuard } from '@/src/contracts/context';
import type { GateAssessment, DomainError } from '@/src/contracts/results';
import type { SRView, StageTransition } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';

function localError(error: unknown, message: string): DomainError {
  return { code: 'STORE_UNAVAILABLE', message: error instanceof Error ? error.message : message, blockers: [], assigneeIds: [], targetRefs: [] };
}

export function GateConditionPanel({ actorId, projectId, sr, initial, actorName, displayLabel, planMode = false, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly sr: SRView;
  readonly initial: GateAssessment;
  readonly actorName: (id: string) => string;
  readonly displayLabel?: string;
  readonly planMode?: boolean;
  onSaved(): void;
}) {
  const gate = initial.gate;
  const label = displayLabel ?? (gate === 'G1' ? '요구사항' : '계획');
  const destination = gate === 'G1' ? '계획' : '구현 준비';
  const srId = sr.scope.srId;
  const [assessment, setAssessment] = useState(initial);
  const identity = { actorId, scope: { kind: 'sr' as const, projectId, srId }, target: gate, form: 'gate-transition' };
  const initialBasis = { srRevision: sr.revision, currentBundleRef: initial.currentBundleRef, reviewEpoch: initial.reviewEpoch };
  const draft = useMemo(() => new FormDraft(identity, { reason: '' }, initialBasis), [actorId, projectId, srId]);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [checking, setChecking] = useState(false);
  const [queryError, setQueryError] = useState<string>();
  const querySequence = useRef(0);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId]);
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => {
    setAssessment(initial);
    draft.refreshFromServer({ reason: '' }, { srRevision: sr.revision, currentBundleRef: initial.currentBundleRef, reviewEpoch: initial.reviewEpoch });
    setSnapshot(draft.snapshot());
  }, [draft, initial, sr.revision]);

  const assess = async () => {
    const sequence = ++querySequence.current;
    setChecking(true); setQueryError(undefined);
    try {
      const result = await invoke('M-027', { actorId, projectId, srId }, gate);
      if (sequence !== querySequence.current) return;
      if (!result.ok) setQueryError(result.error.message); else {
        setAssessment(result.value);
        draft.refreshFromServer({ reason: '' }, { srRevision: sr.revision, currentBundleRef: result.value.currentBundleRef, reviewEpoch: result.value.reviewEpoch });
        setSnapshot(draft.snapshot());
      }
    } catch (error) {
      if (sequence === querySequence.current) setQueryError(error instanceof Error ? error.message : '검토 조건을 확인하지 못했습니다.');
    } finally { if (sequence === querySequence.current) setChecking(false); }
  };

  const execute = async (attempt: CommandAttempt<StageTransition, RevisionAndBundleGuard<'sr'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const response = await invoke('M-028', { actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey }, attempt.submission.input);
      const resolved = session.resolve(attempt, asCommandResult(response), { actorId, scope: { kind: 'sr', projectId, srId }, target: gate, command: 'M-028' });
      if (!resolved.appliesToCurrentForm) return;
      if (resolved.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolved.result.error });
        if (resolved.result.error.code === 'STALE_VERSION' || resolved.result.error.code === 'STALE_BUNDLE') onSaved();
        return;
      }
      setFeedback(resolved.result.kind === 'replayed'
        ? { kind: 'replayed', message: planMode ? '이미 완료한 문서 승인을 확인했습니다.' : '이미 완료한 단계 이동을 확인했습니다.', receiptId: resolved.result.priorReceipt.receiptId }
        : { kind: 'committed', message: planMode ? '현재 문서 버전을 최종 승인했습니다.' : `${destination} 단계로 이동했습니다.` });
      onSaved();
    } catch (error) {
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error, '단계를 이동하지 못했습니다.') });
    } finally { session.endExecution(attempt); }
  };

  const transition = () => {
    const reason = planMode
      ? '현재 Inception Plan과 지정 검토자 전원의 승인을 확인해 결재를 완료합니다.'
      : snapshot.input.reason;
    if (snapshot.basis.currentBundleRef === undefined || reason.trim() === '') {
      setFeedback({ kind: 'rejected', error: { code: 'VALIDATION_ERROR', message: '단계 이동 이유를 입력해 주세요.', blockers: [], assigneeIds: [], targetRefs: [] } });
      return;
    }
    const input: StageTransition = { toStage: gate === 'G1' ? 'planning' : 'ready', reason, gate, bundleRef: snapshot.basis.currentBundleRef };
    const guard: RevisionAndBundleGuard<'sr'> = {
      resource: { target: { kind: 'sr', projectId, srId, entityId: srId }, expectedRevision: snapshot.basis.srRevision },
      expectedBundleRef: snapshot.basis.currentBundleRef,
      expectedReviewEpoch: snapshot.basis.reviewEpoch,
    };
    void execute(session.submit({ actorId, scope: { kind: 'sr', projectId, srId }, target: gate, command: 'M-028', input, guard }));
  };

  return <section className="gate-conditions" aria-label={`${label} 검토 확인 사항`}>
    <p className="eyebrow">{label} 검토</p><h3>{planMode ? 'Plan 결재 전 확인 사항' : '다음 단계로 가기 위한 확인 사항'}</h3>
    <button type="button" onClick={() => { void assess(); }} disabled={checking}>{checking ? '확인 중…' : '검토 조건 다시 확인'}</button>
    {queryError !== undefined && <p role="alert">{queryError}</p>}
    {assessment.canTransition && <p className="success-note">검토에 필요한 확인을 모두 마쳤습니다.</p>}
    {planMode ? <details className="gate-condition-details"><summary>검토 조건 상세 보기</summary>
      <ul className="condition-list">{assessment.conditions.map((condition) => <li key={condition.conditionId} className={condition.passed ? 'condition-pass' : 'condition-fail'}>
        <strong>{condition.passed ? '충족' : '확인 필요'}</strong><span>{condition.reason}</span>
        {condition.assigneeIds.length > 0 && <small>확인할 사람: {condition.assigneeIds.map(actorName).join(', ')}</small>}
      </li>)}</ul>
    </details> : <ul className="condition-list">{assessment.conditions.map((condition) => <li key={condition.conditionId} className={condition.passed ? 'condition-pass' : 'condition-fail'}>
      <strong>{condition.passed ? '충족' : '확인 필요'}</strong><span>{condition.reason}</span>
      {condition.assigneeIds.length > 0 && <small>확인할 사람: {condition.assigneeIds.map(actorName).join(', ')}</small>}
    </li>)}</ul>}
    {actorId === sr.ownerId && sr.progressStage === (gate === 'G1' ? 'requirements' : 'planning') && (assessment.canTransition || snapshot.dirty) && <div className="gate-transition">
      {!planMode && <label>단계 이동 이유<textarea value={snapshot.input.reason} onChange={(event) => { draft.edit({ reason: event.target.value }); setSnapshot(draft.snapshot()); }} /></label>}
      {snapshot.latestServer !== undefined && <div className="draft-comparison"><p>검토 기준이 새로 바뀌었습니다. 작성한 이유는 유지했습니다.</p><div className="draft-actions">
        <button type="button" onClick={() => { draft.adoptLatestBasis(identity); setSnapshot(draft.snapshot()); }}>현재 작성 내용에 최신 기준 사용</button>
        <button type="button" onClick={() => { draft.discardToLatest(identity); setSnapshot(draft.snapshot()); }}>작성 내용 폐기</button>
      </div></div>}
      <button type="button" className="primary-button" onClick={transition} disabled={!assessment.canTransition || snapshot.latestServer !== undefined || feedback.kind === 'processing'}>{planMode ? '문서 최종 승인' : `검토 완료하고 ${destination} 단계로 이동`}</button>
    </div>}
    <CommandFeedback state={feedback} />
  </section>;
}
