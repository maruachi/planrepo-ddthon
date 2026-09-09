import { useEffect, useMemo, useRef, useState } from 'react';
import type { RevisionGuard } from '@/src/contracts/context';
import type { DecisionConfirmation, DecisionRevision, DecisionView, SRDetailView } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import { ScopeClassificationForm } from './ScopeClassificationForm';

interface MemberOption {
  readonly actorId: string;
  readonly displayName: string;
}

interface DecisionDraft {
  readonly optionId: string;
  readonly rationale: string;
  readonly evidence: string;
}

interface DecisionBasis {
  readonly revision: number;
  readonly state: DecisionView['state'];
  readonly selection: string;
}

const blankDecision = (decision: DecisionView): DecisionDraft => ({
  optionId: decision.alternatives[0]?.optionId ?? '', rationale: '', evidence: '',
});

const decisionBasis = (decision: DecisionView): DecisionBasis => ({
  revision: decision.revision,
  state: decision.state,
  selection: decision.currentConfirmation?.selection.text ?? '',
});

function DecisionForm({ actorId, projectId, decision, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly decision: DecisionView;
  onSaved(): void;
}) {
  const { srId } = decision.scope;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: decision.scope, target: decision.decisionId, form: 'decision-confirmation' },
    blankDecision(decision), decisionBasis(decision),
  ), [actorId, projectId, srId, decision.decisionId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, decision.decisionId]);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    draft.refreshFromServer(blankDecision(decision), decisionBasis(decision));
    setSnapshot(draft.snapshot());
  }, [decision, draft]);

  const edit = (patch: Partial<DecisionDraft>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };
  const execute = async (attempt: CommandAttempt<DecisionConfirmation, RevisionGuard<'decision'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-012', {
        actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId, scope: decision.scope, target: decision.decisionId, command: 'M-012',
      });
      if (!resolution.appliesToCurrentForm) return;
      const live = draft.snapshot().input;
      if (
        live.optionId !== attempt.submission.input.selection.optionId ||
        live.rationale !== attempt.submission.input.rationale ||
        live.evidence !== ('text' in attempt.submission.input.evidence ? attempt.submission.input.evidence.text : '')
      ) {
        if (resolution.result.kind === 'rejected') {
          setFeedback({ kind: 'idle' });
        } else {
          setFeedback({ kind: 'committed', message: '이전 결정의 확정 결과를 확인했습니다. 현재 편집은 유지했습니다.' });
          onSaved();
        }
        return;
      }
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        return;
      }
      draft.markSaved(blankDecision(resolution.result.value), decisionBasis(resolution.result.value));
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 확정된 결정을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '결정을 확정했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else {
        setFeedback({ kind: 'rejected', error: {
          code: 'STORE_UNAVAILABLE', message: error instanceof Error ? error.message : '결정을 확정하지 못했습니다.',
          blockers: [], assigneeIds: [], targetRefs: [],
        } });
      }
    } finally { session.endExecution(attempt); }
  };

  const submit = () => {
    const current = draft.snapshot();
    const selected = decision.alternatives.find((alternative) => alternative.optionId === current.input.optionId);
    if (selected === undefined) return;
    const input: DecisionConfirmation = {
      decisionId: decision.decisionId,
      selection: { optionId: selected.optionId, text: selected.label },
      rationale: current.input.rationale,
      evidence: { text: current.input.evidence },
    };
    const guard: RevisionGuard<'decision'> = { resource: {
      target: { kind: 'decision', projectId, srId, entityId: decision.decisionId },
      expectedRevision: current.basis.revision,
    } };
    void execute(session.submit({ actorId, scope: decision.scope, target: decision.decisionId, command: 'M-012', input, guard }));
  };

  const adoptLatest = () => {
    if (!draft.adoptLatestBasis(snapshot.identity)) return;
    setSnapshot(draft.snapshot());
    setFeedback({ kind: 'idle' });
  };
  const discardLatest = () => {
    if (!draft.discardToLatest(snapshot.identity)) return;
    setSnapshot(draft.snapshot());
    setFeedback({ kind: 'idle' });
  };

  if (decision.decisionMakerId !== actorId) return <p className="quiet">결정권자만 확정할 수 있습니다.</p>;
  if (decision.state !== 'unconfirmed' && !snapshot.dirty) return null;
  return (
    <div className="entity-form">
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <fieldset><legend>결정 선택</legend>{decision.alternatives.map((alternative) => (
          <label className="radio-label" key={alternative.optionId}><input type="radio" name={`decision-${decision.decisionId}`} checked={snapshot.input.optionId === alternative.optionId} onChange={() => edit({ optionId: alternative.optionId })} />{alternative.label}<small>{alternative.description}</small></label>
        ))}</fieldset>
        <label>결정 이유<textarea required rows={3} value={snapshot.input.rationale} onChange={(event) => edit({ rationale: event.target.value })} /></label>
        <label>결정 근거<textarea required rows={3} value={snapshot.input.evidence} onChange={(event) => edit({ evidence: event.target.value })} /></label>
        <button className="primary-button" type="submit">결정 확정</button>
      </form>
      {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 결정 입력이 있습니다. 새 조회가 이 입력을 덮어쓰지 않습니다.</p>}
      {snapshot.latestServer !== undefined && <div className="draft-comparison" role="status">
        <p><strong>최신 decision revision {snapshot.latestServer.basis.revision} · {snapshot.latestServer.basis.state === 'confirmed' ? '확정됨' : '미확정'}</strong></p>
        {snapshot.latestServer.basis.selection !== '' && <p>{snapshot.latestServer.basis.selection}</p>}
        {snapshot.latestServer.basis.state === 'confirmed' && <p>이 결정은 이미 확정됐습니다. 재확정은 아직 지원하지 않습니다.</p>}
        <div className="draft-actions">{snapshot.latestServer.basis.state === 'unconfirmed' && <button type="button" onClick={adoptLatest}>최신 decision 기준으로 계속 작성</button>}<button type="button" onClick={discardLatest}>작성 중 결정 폐기</button></div>
      </div>}
      <CommandFeedback state={feedback} />
    </div>
  );
}

interface RevisionDraft {
  readonly optionId: string;
  readonly rationale: string;
  readonly evidence: string;
  readonly changeReason: string;
}

function RedecideForm({ actorId, projectId, decision, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly decision: DecisionView;
  onSaved(): void;
}) {
  const srId = decision.scope.srId;
  const initial = (): RevisionDraft => ({
    optionId: decision.currentConfirmation?.selection.optionId ?? decision.alternatives[0]?.optionId ?? '',
    rationale: '', evidence: '', changeReason: '',
  });
  const identity = `${actorId}:${projectId}:${srId}:${decision.decisionId}:M-013`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: decision.scope, target: decision.decisionId, form: 'decision-revision' },
    initial(), { revision: decision.revision, confirmedVersion: decision.currentConfirmation?.ref.version ?? 0 },
  ), [actorId, projectId, srId, decision.decisionId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, decision.decisionId]);
  const mounted = useRef(false);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    draft.refreshFromServer(initial(), { revision: decision.revision, confirmedVersion: decision.currentConfirmation?.ref.version ?? 0 });
    setSnapshot(draft.snapshot());
  }, [draft, decision]);
  const edit = (patch: Partial<RevisionDraft>) => { draft.edit({ ...draft.snapshot().input, ...patch }); setSnapshot(draft.snapshot()); };
  const execute = async (attempt: CommandAttempt<DecisionRevision, RevisionGuard<'decision'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-013', { actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), { actorId, scope: decision.scope, target: decision.decisionId, command: 'M-013' });
      if (!resolution.appliesToCurrentForm || currentIdentity.current !== identity) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      const live = draft.snapshot().input;
      const selected = decision.alternatives.find((alternative) => alternative.optionId === live.optionId);
      if (selected === undefined || JSON.stringify({
        decisionId: decision.decisionId, selection: { optionId: selected.optionId, text: selected.label },
        rationale: live.rationale, evidence: { text: live.evidence },
        previousVersionRef: attempt.submission.input.previousVersionRef, changeReason: live.changeReason,
      }) !== JSON.stringify(attempt.submission.input)) {
        setFeedback({ kind: 'committed', message: '이전 재결정 결과를 반영했습니다. 현재 편집은 유지했습니다.' });
        onSaved(); return;
      }
      draft.markSaved(initial(), { revision: resolution.result.value.revision, confirmedVersion: resolution.result.value.currentConfirmation?.ref.version ?? 0 });
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 재결정을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '재결정을 저장했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: {
        code: 'STORE_UNAVAILABLE', message: error instanceof Error ? error.message : '재결정을 저장하지 못했습니다.', blockers: [], assigneeIds: [], targetRefs: [],
      } });
    } finally { session.endExecution(attempt); }
  };
  const submit = () => {
    const current = draft.snapshot();
    const previous = decision.currentConfirmation;
    const selected = decision.alternatives.find((alternative) => alternative.optionId === current.input.optionId);
    if (previous === undefined || selected === undefined) return;
    const input: DecisionRevision = {
      decisionId: decision.decisionId, selection: { optionId: selected.optionId, text: selected.label },
      rationale: current.input.rationale, evidence: { text: current.input.evidence },
      previousVersionRef: previous.ref, changeReason: current.input.changeReason,
    };
    const guard: RevisionGuard<'decision'> = { resource: { target: { kind: 'decision', projectId, srId, entityId: decision.decisionId }, expectedRevision: current.basis.revision } };
    void execute(session.submit({ actorId, scope: decision.scope, target: decision.decisionId, command: 'M-013', input, guard }));
  };
  const adoptLatest = () => { if (draft.adoptLatestBasis(snapshot.identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } };
  const discardLatest = () => { if (draft.discardToLatest(snapshot.identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } };
  if (decision.state !== 'confirmed' || decision.currentConfirmation === undefined || decision.decisionMakerId !== actorId) return null;
  return <div className="entity-form">
    <button className="text-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>재결정</button>
    {open && <><form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <fieldset><legend>새 결정 선택</legend>{decision.alternatives.map((alternative) => <label className="radio-label" key={alternative.optionId}><input type="radio" name={`revision-${decision.decisionId}`} checked={snapshot.input.optionId === alternative.optionId} onChange={() => edit({ optionId: alternative.optionId })} />{alternative.label}<small>{alternative.description}</small></label>)}</fieldset>
      <label>새 결정 이유<textarea required value={snapshot.input.rationale} onChange={(event) => edit({ rationale: event.target.value })} /></label>
      <label>새 결정 근거<textarea required value={snapshot.input.evidence} onChange={(event) => edit({ evidence: event.target.value })} /></label>
      <label>재결정 변경 이유<textarea required value={snapshot.input.changeReason} onChange={(event) => edit({ changeReason: event.target.value })} /></label>
      <button className="primary-button" type="submit">재결정 저장</button>
    </form>
    {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 재결정이 있습니다.</p>}
    {snapshot.latestServer !== undefined && <div className="draft-comparison" role="status"><p>최신 decision revision {snapshot.latestServer.basis.revision}을 확인했습니다.</p><div className="draft-actions"><button type="button" onClick={adoptLatest}>최신 결정 기준으로 계속 작성</button><button type="button" onClick={discardLatest}>작성 중 재결정 폐기</button></div></div>}
    <CommandFeedback state={feedback} /></>}
  </div>;
}

export function DecisionPanel({ actorId, projectId, detail, members, actorName, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly members: readonly MemberOption[];
  readonly actorName: (actorId: string) => string;
  onSaved(): void;
}) {
  return (
    <section className="entity-panel" aria-labelledby="decisions-title">
      <div className="section-heading"><div><p className="eyebrow">사람 확정</p><h2 id="decisions-title">결정</h2></div></div>
      {detail.decisions.length === 0 ? <p className="empty-state">등록된 결정이 없습니다.</p> : detail.decisions.map((decision) => (
        <article className="entity-card" data-testid={`decision-${decision.decisionId}`} key={decision.decisionId}>
          <div className="entity-heading"><h3>{decision.prompt}</h3><span>{decision.state === 'confirmed' ? '확정됨' : '미확정'}</span></div>
          <p>{decision.impact}</p>
          <dl className="entity-meta"><div><dt>결정권자</dt><dd>{actorName(decision.decisionMakerId)}</dd></div><div><dt>필요 게이트</dt><dd>{decision.requiredGate}</dd></div><div><dt>현재 revision</dt><dd>{decision.revision}</dd></div></dl>
          <div className="decision-definition"><strong>검토할 대안</strong><ul>{decision.alternatives.map((alternative) => <li key={alternative.optionId}><b>{alternative.label}</b><span>{alternative.description}</span></li>)}</ul>{decision.recommendation !== undefined && <p>추천: {decision.alternatives.find((alternative) => alternative.optionId === decision.recommendation)?.label ?? decision.recommendation}</p>}</div>
          {decision.originQuestionId !== undefined && <p className="quiet">질문 {decision.originQuestionId}의 결과 {decision.originQuestionResultSnapshotRef === undefined ? '' : `v${decision.originQuestionResultSnapshotRef.version}`}에서 전환됨</p>}
          {decision.currentConfirmation !== undefined && <div className="answer-record"><strong>확정 내용</strong><p>{decision.currentConfirmation.selection.text}</p><p>{decision.currentConfirmation.rationale}</p><small>확정자 {actorName(decision.currentConfirmation.decidedBy)} · {decision.currentConfirmation.decidedAt}</small><small>근거: {'text' in decision.currentConfirmation.evidence ? decision.currentConfirmation.evidence.text : `${decision.currentConfirmation.evidence.refs.length}개 참조`}</small>{decision.currentConfirmation.previousVersionRef !== undefined && <small>이전 결정 v{decision.currentConfirmation.previousVersionRef.version}</small>}{decision.currentConfirmation.changeReason !== undefined && <p>변경 이유: {decision.currentConfirmation.changeReason}</p>}</div>}
          <DecisionForm actorId={actorId} projectId={projectId} decision={decision} onSaved={onSaved} />
          <RedecideForm actorId={actorId} projectId={projectId} decision={decision} onSaved={onSaved} />
          <ScopeClassificationForm actorId={actorId} projectId={projectId} ownerId={detail.sr.ownerId} target={decision} members={members} artifacts={detail.artifacts} decisions={detail.decisions} onSaved={onSaved} />
        </article>
      ))}
    </section>
  );
}
