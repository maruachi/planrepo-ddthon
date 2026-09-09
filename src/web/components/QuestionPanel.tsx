import { useEffect, useMemo, useRef, useState } from 'react';
import type { RevisionGuard } from '@/src/contracts/context';
import type {
  DecisionAlternative,
  DecisionConversion,
  FollowupQuestion,
  QuestionAnswer,
  QuestionResolution,
  QuestionView,
  SRDetailView,
} from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import { ScopeClassificationForm } from './ScopeClassificationForm';

interface MemberOption {
  readonly actorId: string;
  readonly displayName: string;
}

interface AnswerDraft {
  readonly mode: 'choice' | 'free_text';
  readonly optionId: string;
  readonly text: string;
  readonly evidence: string;
}

interface AnswerBasis {
  readonly revision: number;
  readonly status: QuestionView['status'];
  readonly selectedAnswer: string;
}

const blankAnswer = (question: QuestionView): AnswerDraft => ({
  mode: question.answerMode === 'choice' ? 'choice' : 'free_text',
  optionId: question.options[0]?.optionId ?? '',
  text: '',
  evidence: '',
});

const answerBasis = (question: QuestionView): AnswerBasis => ({
  revision: question.revision,
  status: question.status,
  selectedAnswer: question.currentResult.selectedAnswer?.answer.text ?? '',
});

function answerValue(question: QuestionView, input: AnswerDraft): QuestionAnswer['answer'] {
  const selected = question.options.find((option) => option.optionId === input.optionId);
  return input.mode === 'choice' && selected !== undefined
    ? { kind: 'choice', optionId: selected.optionId, text: selected.text }
    : { kind: 'free_text', text: input.text };
}

function localError(error: unknown, fallback: string) {
  return {
    code: 'STORE_UNAVAILABLE' as const,
    message: error instanceof Error ? error.message : fallback,
    blockers: [], assigneeIds: [], targetRefs: [],
  };
}

function AnswerForm({ actorId, projectId, question, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly question: QuestionView;
  onSaved(): void;
}) {
  const { srId } = question.scope;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: question.scope, target: question.questionId, form: 'question-answer' },
    blankAnswer(question),
    answerBasis(question),
  ), [actorId, projectId, srId, question.questionId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, question.questionId]);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    draft.refreshFromServer(blankAnswer(question), answerBasis(question));
    setSnapshot(draft.snapshot());
  }, [draft, question]);

  const edit = (patch: Partial<AnswerDraft>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };

  const execute = async (attempt: CommandAttempt<QuestionAnswer, RevisionGuard<'question'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-008', {
        actorId, projectId, srId, guard: attempt.submission.guard,
        idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId, scope: question.scope, target: question.questionId, command: 'M-008',
      });
      if (!resolution.appliesToCurrentForm) return;
      const live = draft.snapshot().input;
      if (
        JSON.stringify(answerValue(question, live)) !== JSON.stringify(attempt.submission.input.answer) ||
        live.evidence !== ('text' in attempt.submission.input.evidence ? attempt.submission.input.evidence.text : '')
      ) {
        if (resolution.result.kind === 'rejected') {
          setFeedback({ kind: 'idle' });
        } else {
          setFeedback({ kind: 'committed', message: '이전 답변의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.' });
          onSaved();
        }
        return;
      }
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        return;
      }
      draft.markSaved(blankAnswer(resolution.result.value), answerBasis(resolution.result.value));
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 답변을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '답변을 저장했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else {
        setFeedback({ kind: 'rejected', error: localError(error, '답변을 저장하지 못했습니다.') });
      }
    } finally {
      session.endExecution(attempt);
    }
  };

  const submit = () => {
    const current = draft.snapshot();
    const guard: RevisionGuard<'question'> = { resource: {
      target: { kind: 'question', projectId, srId, entityId: question.questionId },
      expectedRevision: current.basis.revision,
    } };
    void execute(session.submit({
      actorId, scope: question.scope, target: question.questionId, command: 'M-008',
      input: {
        questionId: question.questionId,
        answeredQuestionSnapshotRef: question.currentResult.ref,
        answer: answerValue(question, current.input),
        evidence: { text: current.input.evidence },
      },
      guard,
    }));
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

  if (question.assigneeId !== actorId) return <p className="quiet">현재 담당자만 답변할 수 있습니다.</p>;
  if (question.status !== 'open' && !snapshot.dirty) return null;
  return (
    <div className="entity-form">
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {question.answerMode === 'choice' && (
          <fieldset>
            <legend>답변 형식</legend>
            <label className="radio-label"><input type="radio" name={`answer-mode-${question.questionId}`} checked={snapshot.input.mode === 'choice'} onChange={() => edit({ mode: 'choice' })} />선택지</label>
            <label className="radio-label"><input type="radio" name={`answer-mode-${question.questionId}`} checked={snapshot.input.mode === 'free_text'} onChange={() => edit({ mode: 'free_text' })} />직접 작성</label>
          </fieldset>
        )}
        {question.answerMode === 'choice' && snapshot.input.mode === 'choice' ? (
          <fieldset><legend>답변 선택</legend>{question.options.map((option) => (
            <label className="radio-label" key={option.optionId}><input type="radio" name={`answer-${question.questionId}`} value={option.optionId} checked={snapshot.input.optionId === option.optionId} onChange={() => edit({ optionId: option.optionId })} />{option.text}</label>
          ))}</fieldset>
        ) : <label>직접 작성 답변<textarea required rows={4} value={snapshot.input.text} onChange={(event) => edit({ text: event.target.value })} /></label>}
        <label>답변 근거<textarea required rows={3} value={snapshot.input.evidence} onChange={(event) => edit({ evidence: event.target.value })} /></label>
        <button className="primary-button" type="submit">답변 저장</button>
      </form>
      {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 답변이 있습니다. 새 조회가 이 입력을 덮어쓰지 않습니다.</p>}
      {snapshot.latestServer !== undefined && (
        <div className="draft-comparison" role="status">
          <p><strong>최신 질문 revision {snapshot.latestServer.basis.revision} · {snapshot.latestServer.basis.status === 'answered' ? '답변됨' : snapshot.latestServer.basis.status}</strong></p>
          {snapshot.latestServer.basis.selectedAnswer !== '' && <p>{snapshot.latestServer.basis.selectedAnswer}</p>}
          {snapshot.latestServer.basis.status !== 'open' && <p>이 질문은 이미 답변됐습니다. 추가 답변 저장은 아직 지원하지 않습니다.</p>}
          <div className="draft-actions">
            {snapshot.latestServer.basis.status === 'open' && <button type="button" onClick={adoptLatest}>최신 질문 기준으로 계속 작성</button>}
            <button type="button" onClick={discardLatest}>작성 중 답변 폐기</button>
          </div>
        </div>
      )}
      <CommandFeedback state={feedback} />
    </div>
  );
}

interface FollowupDraft {
  readonly text: string;
  readonly reason: string;
  readonly assigneeId: string;
  readonly answerMode: 'free_text' | 'choice';
  readonly optionsText: string;
  readonly requiredGate: 'G1' | 'G2';
}

const blankFollowup = (actorId: string): FollowupDraft => ({
  text: '', reason: '', assigneeId: actorId, answerMode: 'free_text', optionsText: '', requiredGate: 'G1',
});

function followupValue(question: QuestionView, input: FollowupDraft): FollowupQuestion {
  const optionLines = input.optionsText.split('\n').map((line) => line.trim()).filter(Boolean);
  return input.answerMode === 'choice'
    ? {
        parentQuestionId: question.questionId, text: input.text, reason: input.reason,
        assigneeId: input.assigneeId, answerMode: 'choice',
        options: optionLines.map((text, index) => ({ optionId: `option-${index + 1}`, text })) as [{ optionId: string; text: string }, ...Array<{ optionId: string; text: string }>],
        classification: { scope: 'current', requiredGate: input.requiredGate, reason: input.reason },
      }
    : {
        parentQuestionId: question.questionId, text: input.text, reason: input.reason,
        assigneeId: input.assigneeId, answerMode: 'free_text',
        classification: { scope: 'current', requiredGate: input.requiredGate, reason: input.reason },
      };
}

function FollowupForm({ actorId, projectId, question, members, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly question: QuestionView;
  readonly members: readonly MemberOption[];
  onSaved(): void;
}) {
  const { srId } = question.scope;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: question.scope, target: question.questionId, form: 'followup-question' },
    blankFollowup(members[0]?.actorId ?? actorId),
    { revision: question.revision },
  ), [actorId, projectId, srId, question.questionId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, question.questionId]);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  const mounted = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    draft.refreshFromServer(blankFollowup(members[0]?.actorId ?? actorId), { revision: question.revision });
    setSnapshot(draft.snapshot());
  }, [draft, members, actorId, question.revision]);

  const edit = (patch: Partial<FollowupDraft>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };
  const execute = async (attempt: CommandAttempt<FollowupQuestion, RevisionGuard<'question'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-010', {
        actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId, scope: question.scope, target: question.questionId, command: 'M-010',
      });
      if (!resolution.appliesToCurrentForm) return;
      if (JSON.stringify(followupValue(question, draft.snapshot().input)) !== JSON.stringify(attempt.submission.input)) {
        if (resolution.result.kind === 'rejected') {
          setFeedback({ kind: 'idle' });
        } else {
          setFeedback({ kind: 'committed', message: '이전 후속 질문의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.' });
          onSaved();
        }
        return;
      }
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        return;
      }
      draft.markSaved(blankFollowup(members[0]?.actorId ?? actorId), { revision: question.revision });
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 후속 질문을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '후속 질문을 저장했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error, '후속 질문을 저장하지 못했습니다.') });
    } finally { session.endExecution(attempt); }
  };

  const submit = () => {
    const current = draft.snapshot();
    const guard: RevisionGuard<'question'> = { resource: {
      target: { kind: 'question', projectId, srId, entityId: question.questionId }, expectedRevision: current.basis.revision,
    } };
    void execute(session.submit({ actorId, scope: question.scope, target: question.questionId, command: 'M-010', input: followupValue(question, current.input), guard }));
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

  return (
    <div className="followup-form">
      <button className="text-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>후속 질문 추가</button>
      {open && <>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label>후속 질문<textarea required data-testid={`followup-text-${question.questionId}`} value={snapshot.input.text} onChange={(event) => edit({ text: event.target.value })} /></label>
          <label>후속 질문 이유<textarea required value={snapshot.input.reason} onChange={(event) => edit({ reason: event.target.value })} /></label>
          <label>후속 질문 담당자<select value={snapshot.input.assigneeId} onChange={(event) => edit({ assigneeId: event.target.value })}>{members.map((member) => <option key={member.actorId} value={member.actorId}>{member.displayName}</option>)}</select></label>
          <label>답변 방식<select value={snapshot.input.answerMode} onChange={(event) => edit({ answerMode: event.target.value as FollowupDraft['answerMode'] })}><option value="free_text">자유 입력</option><option value="choice">선택형</option></select></label>
          {snapshot.input.answerMode === 'choice' && <label>선택지 (한 줄에 하나)<textarea required value={snapshot.input.optionsText} onChange={(event) => edit({ optionsText: event.target.value })} /></label>}
          <label>필요 게이트<select value={snapshot.input.requiredGate} onChange={(event) => edit({ requiredGate: event.target.value as FollowupDraft['requiredGate'] })}><option value="G1">G1</option><option value="G2">G2</option></select></label>
          <button className="primary-button" type="submit">후속 질문 저장</button>
        </form>
        {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 후속 질문이 있습니다.</p>}
        {snapshot.latestServer !== undefined && <div className="draft-comparison" role="status">
          <p><strong>최신 부모 질문 revision {snapshot.latestServer.basis.revision}</strong></p>
          <p>현재 작성 기준은 revision {snapshot.basis.revision}입니다. 입력을 유지한 채 최신 기준을 채택하거나 폐기할 수 있습니다.</p>
          <div className="draft-actions"><button type="button" onClick={adoptLatest}>최신 부모 질문 기준으로 계속 작성</button><button type="button" onClick={discardLatest}>작성 중 후속 질문 폐기</button></div>
        </div>}
        <CommandFeedback state={feedback} />
      </>}
    </div>
  );
}

function statusLabel(status: QuestionView['status']): string {
  if (status === 'open') return '열림';
  if (status === 'answered') return '답변됨';
  if (status === 'resolved') return '해결됨';
  return '결정으로 전환됨';
}

function versionRefLabel(ref: QuestionView['sourceRefs'][number]): string {
  return `${ref.kind} · ${ref.entityId} · v${ref.version}`;
}

interface ResolutionDraft {
  readonly evidence: string;
  readonly disposition: 'not_required' | 'reflected';
  readonly reason: string;
  readonly artifactKeys: readonly string[];
}

const blankResolution = (): ResolutionDraft => ({
  evidence: '', disposition: 'not_required', reason: '', artifactKeys: [],
});

function artifactKey(ref: { readonly entityId: string; readonly version: number }): string {
  return `${ref.entityId}:${ref.version}`;
}

function ResolveQuestionForm({ actorId, projectId, question, detail, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly question: QuestionView;
  readonly detail: SRDetailView;
  onSaved(): void;
}) {
  const srId = question.scope.srId;
  const identity = `${actorId}:${projectId}:${srId}:${question.questionId}:M-009`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: question.scope, target: question.questionId, form: 'question-resolution' },
    blankResolution(),
    { revision: question.revision, selectedAnswerVersion: question.currentResult.selectedAnswer?.ref.version ?? 0 },
  ), [actorId, projectId, srId, question.questionId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, question.questionId]);
  const mounted = useRef(false);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    draft.refreshFromServer(
      blankResolution(),
      { revision: question.revision, selectedAnswerVersion: question.currentResult.selectedAnswer?.ref.version ?? 0 },
    );
    setSnapshot(draft.snapshot());
  }, [draft, question]);
  const edit = (patch: Partial<ResolutionDraft>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };
  const execute = async (attempt: CommandAttempt<QuestionResolution, RevisionGuard<'question'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-009', {
        actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId, scope: question.scope, target: question.questionId, command: 'M-009',
      });
      if (!resolution.appliesToCurrentForm || currentIdentity.current !== identity) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      const live = draft.snapshot().input;
      if (JSON.stringify(attempt.submission.input) !== JSON.stringify({
        questionId: question.questionId,
        selectedAnswerRef: attempt.submission.input.selectedAnswerRef,
        resolutionEvidence: { text: live.evidence },
        documentDisposition: live.disposition === 'not_required'
          ? { kind: 'not_required', reason: live.reason }
          : { kind: 'reflected', artifactVersionRefs: detail.artifacts.filter((artifact) => live.artifactKeys.includes(artifactKey(artifact.versionRef))).map((artifact) => artifact.versionRef) },
      })) {
        setFeedback({ kind: 'committed', message: '이전 해결 확인 결과를 반영했습니다. 현재 편집은 유지했습니다.' });
        onSaved();
        return;
      }
      draft.markSaved(blankResolution(), {
        revision: resolution.result.value.revision,
        selectedAnswerVersion: resolution.result.value.currentResult.selectedAnswer?.ref.version ?? 0,
      });
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 해결 확인을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '질문 해결을 확인했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error, '해결 확인을 저장하지 못했습니다.') });
    } finally { session.endExecution(attempt); }
  };
  const submit = () => {
    const current = draft.snapshot();
    const selected = question.currentResult.selectedAnswer;
    if (selected === undefined) return;
    const artifactVersionRefs = detail.artifacts
      .filter((artifact) => current.input.artifactKeys.includes(artifactKey(artifact.versionRef)))
      .map((artifact) => artifact.versionRef);
    if (current.input.disposition === 'reflected' && artifactVersionRefs.length === 0) return;
    const input: QuestionResolution = {
      questionId: question.questionId, selectedAnswerRef: selected.ref,
      resolutionEvidence: { text: current.input.evidence },
      documentDisposition: current.input.disposition === 'not_required'
        ? { kind: 'not_required', reason: current.input.reason }
        : { kind: 'reflected', artifactVersionRefs: artifactVersionRefs as [typeof artifactVersionRefs[number], ...Array<typeof artifactVersionRefs[number]>] },
    };
    const guard: RevisionGuard<'question'> = { resource: {
      target: { kind: 'question', projectId, srId, entityId: question.questionId }, expectedRevision: current.basis.revision,
    } };
    void execute(session.submit({ actorId, scope: question.scope, target: question.questionId, command: 'M-009', input, guard }));
  };
  const adoptLatest = () => { if (draft.adoptLatestBasis(snapshot.identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } };
  const discardLatest = () => { if (draft.discardToLatest(snapshot.identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } };
  if (actorId !== detail.sr.ownerId || question.status !== 'answered') return null;
  return <div className="entity-form">
    <button className="text-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>해결 확인</button>
    {open && <><form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label>해결 근거<textarea required value={snapshot.input.evidence} onChange={(event) => edit({ evidence: event.target.value })} /></label>
      <fieldset><legend>문서 반영</legend>
        <label className="radio-label"><input type="radio" name={`resolution-${question.questionId}`} checked={snapshot.input.disposition === 'not_required'} onChange={() => edit({ disposition: 'not_required' })} />문서 변경 불필요</label>
        <label className="radio-label"><input type="radio" name={`resolution-${question.questionId}`} checked={snapshot.input.disposition === 'reflected'} onChange={() => edit({ disposition: 'reflected' })} />현재 문서에 반영됨</label>
      </fieldset>
      {snapshot.input.disposition === 'not_required' ? <label>문서 변경 불필요 이유<textarea required value={snapshot.input.reason} onChange={(event) => edit({ reason: event.target.value })} /></label> :
        <fieldset><legend>반영된 현재 문서</legend>{detail.artifacts.map((artifact) => {
          const key = artifactKey(artifact.versionRef);
          return <label className="checkbox-label" key={key}><input type="checkbox" checked={snapshot.input.artifactKeys.includes(key)} onChange={(event) => edit({ artifactKeys: event.target.checked ? [...snapshot.input.artifactKeys, key] : snapshot.input.artifactKeys.filter((item) => item !== key) })} />{artifact.kind} · v{artifact.versionRef.version} · {artifact.changeSummary}</label>;
        })}</fieldset>}
      <button className="primary-button" type="submit">해결 저장</button>
    </form>
    {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 해결 확인이 있습니다.</p>}
    {snapshot.latestServer !== undefined && <div className="draft-comparison" role="status"><p>최신 질문 revision {snapshot.latestServer.basis.revision}을 확인했습니다.</p><div className="draft-actions"><button type="button" onClick={adoptLatest}>최신 답변 기준으로 계속 작성</button><button type="button" onClick={discardLatest}>작성 중 해결 확인 폐기</button></div></div>}
    <CommandFeedback state={feedback} /></>}
  </div>;
}

interface ConversionDraft {
  readonly prompt: string;
  readonly alternatives: readonly DecisionAlternative[];
  readonly impact: string;
  readonly decisionMakerId: string;
}

function ConvertQuestionForm({ actorId, projectId, question, members, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly question: QuestionView;
  readonly members: readonly MemberOption[];
  onSaved(): void;
}) {
  const srId = question.scope.srId;
  const initial = (): ConversionDraft => ({
    prompt: question.text,
    alternatives: [
      { optionId: 'option-1', label: '', description: '' },
      { optionId: 'option-2', label: '', description: '' },
    ],
    impact: question.reason,
    decisionMakerId: members[0]?.actorId ?? actorId,
  });
  const identity = `${actorId}:${projectId}:${srId}:${question.questionId}:M-011`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: question.scope, target: question.questionId, form: 'question-conversion' },
    initial(), { revision: question.revision, resultVersion: question.currentResult.ref.version, classificationVersion: question.classificationRef.version },
  ), [actorId, projectId, srId, question.questionId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, question.questionId]);
  const mounted = useRef(false);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    draft.refreshFromServer(initial(), { revision: question.revision, resultVersion: question.currentResult.ref.version, classificationVersion: question.classificationRef.version });
    setSnapshot(draft.snapshot());
  }, [draft, question, members]);
  const edit = (patch: Partial<ConversionDraft>) => { draft.edit({ ...draft.snapshot().input, ...patch }); setSnapshot(draft.snapshot()); };
  const editAlternative = (index: number, patch: Partial<DecisionAlternative>) => edit({ alternatives: snapshot.input.alternatives.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const execute = async (attempt: CommandAttempt<DecisionConversion, RevisionGuard<'question'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-011', { actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), { actorId, scope: question.scope, target: question.questionId, command: 'M-011' });
      if (!resolution.appliesToCurrentForm || currentIdentity.current !== identity) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      if (JSON.stringify(draft.snapshot().input) !== JSON.stringify({
        prompt: attempt.submission.input.prompt, alternatives: attempt.submission.input.alternatives,
        impact: attempt.submission.input.impact, decisionMakerId: attempt.submission.input.decisionMakerId,
      })) {
        setFeedback({ kind: 'committed', message: '이전 전환 결과를 반영했습니다. 현재 편집은 유지했습니다.' });
        onSaved(); return;
      }
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 전환된 결정을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '질문을 결정으로 전환했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error, '결정으로 전환하지 못했습니다.') });
    } finally { session.endExecution(attempt); }
  };
  const submit = () => {
    const current = draft.snapshot();
    if (current.input.alternatives.length === 0) return;
    const input: DecisionConversion = {
      questionId: question.questionId, questionResultSnapshotRef: question.currentResult.ref,
      prompt: current.input.prompt,
      alternatives: current.input.alternatives as [DecisionAlternative, ...DecisionAlternative[]],
      impact: current.input.impact, decisionMakerId: current.input.decisionMakerId,
      classificationRef: question.classificationRef,
    };
    const guard: RevisionGuard<'question'> = { resource: { target: { kind: 'question', projectId, srId, entityId: question.questionId }, expectedRevision: current.basis.revision } };
    void execute(session.submit({ actorId, scope: question.scope, target: question.questionId, command: 'M-011', input, guard }));
  };
  const adoptLatest = () => { if (draft.adoptLatestBasis(snapshot.identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } };
  const discardLatest = () => { if (draft.discardToLatest(snapshot.identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } };
  if (question.status === 'converted_to_decision') return null;
  return <div className="entity-form">
    <button className="text-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>결정으로 전환</button>
    {open && <><form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label>결정 문구<textarea required value={snapshot.input.prompt} onChange={(event) => edit({ prompt: event.target.value })} /></label>
      <fieldset><legend>결정 대안</legend>{snapshot.input.alternatives.map((alternative, index) => <div className="structured-row" key={alternative.optionId}>
        <label>대안 이름<input required value={alternative.label} onChange={(event) => editAlternative(index, { label: event.target.value })} /></label>
        <label>대안 설명<textarea required value={alternative.description} onChange={(event) => editAlternative(index, { description: event.target.value })} /></label>
        {snapshot.input.alternatives.length > 1 && <button type="button" onClick={() => edit({ alternatives: snapshot.input.alternatives.filter((_, itemIndex) => itemIndex !== index) })}>대안 삭제</button>}
      </div>)}<button type="button" onClick={() => edit({ alternatives: [...snapshot.input.alternatives, { optionId: `option-${snapshot.input.alternatives.length + 1}`, label: '', description: '' }] })}>대안 추가</button></fieldset>
      <label>결정 영향<textarea required value={snapshot.input.impact} onChange={(event) => edit({ impact: event.target.value })} /></label>
      <label>결정권자<select required value={snapshot.input.decisionMakerId} onChange={(event) => edit({ decisionMakerId: event.target.value })}>{members.map((member) => <option key={member.actorId} value={member.actorId}>{member.displayName}</option>)}</select></label>
      <button className="primary-button" type="submit">결정 전환 저장</button>
    </form>
    {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 결정 전환 입력이 있습니다.</p>}
    {snapshot.latestServer !== undefined && <div className="draft-comparison" role="status"><p>최신 질문 revision {snapshot.latestServer.basis.revision}을 확인했습니다.</p><div className="draft-actions"><button type="button" onClick={adoptLatest}>최신 질문 기준으로 계속 작성</button><button type="button" onClick={discardLatest}>작성 중 결정 전환 폐기</button></div></div>}
    <CommandFeedback state={feedback} /></>}
  </div>;
}

export function QuestionPanel({ actorId, projectId, detail, members, actorName, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly members: readonly MemberOption[];
  readonly actorName: (actorId: string) => string;
  onSaved(): void;
}) {
  return (
    <section className="entity-panel" aria-labelledby="questions-title">
      <div className="section-heading"><div><p className="eyebrow">업무 확인</p><h2 id="questions-title">질문</h2></div></div>
      {detail.questions.length === 0 ? <p className="empty-state">등록된 질문이 없습니다.</p> : detail.questions.map((question) => (
        <article className="entity-card" data-testid={`question-${question.questionId}`} key={question.questionId}>
          <div className="entity-heading"><h3>{question.text}</h3><span>{statusLabel(question.status)}</span></div>
          <p>{question.reason}</p>
          <dl className="entity-meta"><div><dt>담당자</dt><dd>{actorName(question.assigneeId)}</dd></div><div><dt>확인할 시점</dt><dd>{question.requiredGate === 'G1' ? '요구사항 검토 전' : '계획 검토 전'}</dd></div>{question.dueAt !== undefined && <div><dt>답변 기한</dt><dd>{question.dueAt}</dd></div>}</dl>
          {question.options.length > 0 && <div className="question-definition"><strong>선택지</strong><ul>{question.options.map((option) => <li key={option.optionId}>{option.text}</li>)}</ul></div>}
          {question.candidateAnswers.length > 0 && <div className="question-definition"><strong>답변 후보 · 사람 확인 필요</strong><ul>{question.candidateAnswers.map((candidate, index) => <li key={`${index}:${candidate}`}>{candidate}</li>)}</ul></div>}
          {(question.sourceRefs.length > 0 || question.relatedArtifactRefs.length > 0) && <details className="question-definition"><summary>근거와 관련 문서 확인</summary><ul>{question.sourceRefs.map((ref) => <li key={`source:${ref.kind}:${ref.entityId}:${ref.version}`}>출처 {versionRefLabel(ref)}</li>)}{question.relatedArtifactRefs.map((ref) => <li key={`artifact:${ref.entityId}:${ref.version}`}>관련 문서 {versionRefLabel(ref)}</li>)}</ul></details>}
          {question.currentResult.selectedAnswer !== undefined && <div className="answer-record"><strong>현재 답변</strong><p>{question.currentResult.selectedAnswer.answer.text}</p><small>답변자 {actorName(question.currentResult.selectedAnswer.answeredBy)} · {question.currentResult.selectedAnswer.answeredAt}</small><small>근거: {'text' in question.currentResult.selectedAnswer.evidence ? question.currentResult.selectedAnswer.evidence.text : `${question.currentResult.selectedAnswer.evidence.refs.length}개 참조`}</small></div>}
          {question.currentResult.resolution !== undefined && <div className="answer-record"><strong>해결 확인 이력</strong><p>{'text' in question.currentResult.resolution.evidence ? question.currentResult.resolution.evidence.text : `${question.currentResult.resolution.evidence.refs.length}개 근거 참조`}</p><p>{question.currentResult.resolution.documentDisposition.kind === 'not_required' ? question.currentResult.resolution.documentDisposition.reason : `${question.currentResult.resolution.documentDisposition.artifactVersionRefs.length}개 문서에 반영됨`}</p><small>확인자 {actorName(question.currentResult.resolution.resolvedBy)} · {question.currentResult.resolution.resolvedAt}</small></div>}
          {question.convertedDecisionId !== undefined && <p className="quiet">이 질문은 결정할 안건으로 전환했습니다.</p>}
          <AnswerForm actorId={actorId} projectId={projectId} question={question} onSaved={onSaved} />
          <ResolveQuestionForm actorId={actorId} projectId={projectId} question={question} detail={detail} onSaved={onSaved} />
          {detail.sr.ownerId === actorId && <ConvertQuestionForm actorId={actorId} projectId={projectId} question={question} members={members} onSaved={onSaved} />}
          {detail.sr.ownerId === actorId && question.status !== 'converted_to_decision' && <FollowupForm actorId={actorId} projectId={projectId} question={question} members={members} onSaved={onSaved} />}
          <ScopeClassificationForm actorId={actorId} projectId={projectId} ownerId={detail.sr.ownerId} target={question} members={members} artifacts={detail.artifacts} decisions={detail.decisions} onSaved={onSaved} />
        </article>
      ))}
    </section>
  );
}
