import { useEffect, useMemo, useRef, useState } from 'react';
import type { RevisionGuard } from '@/src/contracts/context';
import type { ReviewBundleView, ReviewConfigurationView, ReviewPreparationView, ReviewRequestInput, SRDetailView } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import { g1PlanReadiness } from '../state/plan-review-readiness';

function localError(error: unknown) {
  return { code: 'STORE_UNAVAILABLE' as const, message: error instanceof Error ? error.message : '검토 요청을 저장하지 못했습니다.', blockers: [], assigneeIds: [], targetRefs: [] };
}

function missingLabel(value: string): string {
  if (value.includes('artifact') || value.includes('requirements') || value.includes('document')) return '검토할 필수 문서를 준비해 주세요.';
  if (value.includes('assignment') || value.includes('reviewer')) return '검토자를 배정해 주세요.';
  if (value.includes('policy') || value.includes('checklist') || value.includes('role')) return '팀의 검토 기준과 확인 항목을 준비해 주세요.';
  return '검토에 필요한 자료를 더 준비해 주세요.';
}

export type ReviewRequestAvailability = 'available' | 'blocked' | 'pending' | 'approved' | 'complete';

export function ReviewRequestForm({ actorId, projectId, srId, ownerId, detail, configuration, preparation, availability, displayLabel, canTransition = false, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly srId: string;
  readonly ownerId: string;
  readonly detail: SRDetailView;
  readonly configuration: ReviewConfigurationView;
  readonly preparation: ReviewPreparationView;
  readonly availability: ReviewRequestAvailability;
  readonly displayLabel?: string;
  readonly canTransition?: boolean;
  onSaved(): void;
}) {
  const gate = configuration.gate;
  const label = displayLabel ?? (gate === 'G1' ? '요구사항' : '계획');
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, gate]);
  const mounted = useRef(true);
  const startKey = useRef(crypto.randomUUID());
  const requesting = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const execute = async (attempt: CommandAttempt<ReviewRequestInput, RevisionGuard<'review_gate_state'>>, currentConfiguration = configuration) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const response = await invoke('M-020', {
        actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolved = session.resolve(attempt, asCommandResult(response), {
        actorId, scope: { kind: 'sr', projectId, srId }, target: gate, command: 'M-020',
      });
      if (!resolved.appliesToCurrentForm) return;
      if (resolved.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolved.result.error });
        if (resolved.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      const value: ReviewBundleView = resolved.result.value;
      const reused = value.kind === 'BundleAvailable' && currentConfiguration.currentBundleRef !== undefined &&
        value.bundle.bundleRef.bundleId === currentConfiguration.currentBundleRef?.bundleId &&
        value.bundle.bundleRef.version === currentConfiguration.currentBundleRef?.version;
      setFeedback(resolved.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 처리한 검토 요청을 확인했습니다.', receiptId: resolved.result.priorReceipt.receiptId }
        : { kind: 'committed', message: reused ? `현재 ${label} 검토본을 확인했습니다.` : `새 ${label} 검토본을 준비했습니다.` });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt), currentConfiguration); } });
      } else setFeedback({ kind: 'rejected', error: localError(error) });
    } finally {
      session.endExecution(attempt);
    }
  };

  const request = async () => {
    if (requesting.current) return;
    requesting.current = true;
    setPreparing(true);
    setFeedback({ kind: 'processing' });
    try {
      let latestResponse = await invoke('M-047', { actorId, projectId, srId }, {});
      if (!mounted.current) return;
      if (!latestResponse.ok) {
        setFeedback({ kind: 'rejected', error: latestResponse.error });
        return;
      }
      let latest = latestResponse.value;
      if (gate === 'G1' && latest.sr.progressStage === 'sr_received') {
        const start = await invoke('M-028', {
          actorId,
          projectId,
          srId,
          idempotencyKey: startKey.current,
          guard: { resource: { target: { kind: 'sr', projectId, srId, entityId: srId }, expectedRevision: latest.sr.revision } },
        }, { toStage: 'requirements', reason: '현재 문서를 동료에게 검토 요청합니다.' });
        if (!mounted.current) return;
        if (!start.ok) {
          setFeedback({ kind: 'rejected', error: start.error });
          return;
        }
        latestResponse = await invoke('M-047', { actorId, projectId, srId }, {});
        if (!mounted.current) return;
        if (!latestResponse.ok) {
          setFeedback({ kind: 'rejected', error: latestResponse.error });
          return;
        }
        latest = latestResponse.value;
      }
      const issues = gate === 'G1' ? g1PlanReadiness(latest) : [];
      if (issues.length > 0) {
        setFeedback({ kind: 'rejected', error: {
          code: 'VALIDATION_ERROR', message: issues[0]?.detail ?? '검토 요청 전에 문서와 검토자를 확인해 주세요.',
          blockers: [], assigneeIds: issues.flatMap((issue) => [...issue.assigneeIds]), targetRefs: [],
        } });
        onSaved();
        return;
      }
      const latestConfiguration = latest.reviewConfigurations.find((item) => item.gate === gate);
      const latestPreparation = latest.reviewPreparations.find((item) => item.gate === gate);
      if (latestConfiguration === undefined || latestPreparation === undefined) {
        setFeedback({ kind: 'rejected', error: localError(undefined) });
        return;
      }
      if (latestPreparation.kind !== 'Ready') {
        setFeedback({ kind: 'rejected', error: {
          code: 'VALIDATION_ERROR', message: '현재 문서로 검토 요청을 준비하지 못했습니다. 문서와 검토자를 확인해 주세요.',
          blockers: [], assigneeIds: latestPreparation.assigneeIds, targetRefs: [],
        } });
        onSaved();
        return;
      }
      const guard: RevisionGuard<'review_gate_state'> = {
        resource: { target: { kind: 'review_gate_state', projectId, srId, entityId: gate }, expectedRevision: latestConfiguration.revision },
      };
      await execute(session.submit({ actorId, scope: { kind: 'sr', projectId, srId }, target: gate, command: 'M-020', input: latestPreparation.input, guard }), latestConfiguration);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        setFeedback({ kind: 'confirmation-required', retry: () => { void request(); } });
      } else {
        setFeedback({ kind: 'rejected', error: localError(error) });
      }
    } finally {
      requesting.current = false;
      if (mounted.current) setPreparing(false);
    }
  };

  if (availability === 'complete') {
    return <section className="review-request" aria-label="검토 요청">
      <h3>{label} 검토</h3>
      <p>현재 자료에 대한 {label} 검토를 완료했습니다.</p>
    </section>;
  }
  if (availability === 'approved') {
    return <section className="review-request" aria-label="검토 요청">
      <h3>{label} 검토</h3>
      {canTransition
        ? <p>검토자 전원이 현재 문서를 승인했습니다. 담당자가 문서를 최종 승인할 수 있습니다.</p>
        : <p><strong>검토자 승인 완료 · 추가 확인 필요</strong><br />승인과 별도로 위에 남은 내용을 해결해야 결재를 완료할 수 있습니다.</p>}
    </section>;
  }
  if (availability === 'pending') {
    return <section className="review-request" aria-label="검토 요청">
      <h3>{label} 검토</h3>
      <p>현재 자료를 지정 검토자가 확인하고 있습니다.</p>
    </section>;
  }
  if (availability === 'blocked') {
    return <section className="review-request" aria-label="검토 요청 준비">
      <h3>{label} 검토 요청 준비</h3>
      <p>위에 표시된 내용을 먼저 확인하면 현재 버전으로 검토를 요청할 수 있습니다.</p>
    </section>;
  }

  return <section className="review-request" aria-label="검토 요청">
    <h3>{label} 검토 요청</h3>
    {preparation.kind === 'NeedsInputs' ? <>
      <p>아직 검토를 요청할 수 없습니다.</p>
      <ul>{[...new Set(preparation.missing.map(missingLabel))].map((item) => <li key={item}>{item}</li>)}</ul>
    </> : <>
      <p>현재 문서를 고정해 지정 검토자에게 보냅니다. AI 질문과 제안은 검토 요청을 막지 않습니다.</p>
      <dl className="review-counts">
        <div><dt>문서</dt><dd>{preparation.input.artifactVersionRefs.length}개</dd></div>
        <div><dt>검토자</dt><dd>{preparation.input.reviewerIds.length}명</dd></div>
      </dl>
      {actorId === ownerId
        ? <button type="button" className="primary-button" disabled={preparing} onClick={() => { void request(); }}>{preparing ? '검토 요청 준비 중…' : `${label} 검토 요청`}</button>
        : <p className="quiet">담당자가 공식 검토를 요청할 수 있습니다.</p>}
    </>}
    <CommandFeedback state={feedback} />
  </section>;
}
