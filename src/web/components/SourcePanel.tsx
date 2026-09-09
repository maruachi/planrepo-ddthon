import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContextSourceVersionRef, RevisionGuard } from '@/src/contracts/context';
import type { ContextSourceView, SourceConfirmation, SourceInput } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import { SafeMarkdown } from './SafeMarkdown';

interface SourceDraftInput {
  readonly kind: 'text' | 'markdown' | 'link';
  readonly content: string;
  readonly targetUrl: string;
  readonly provenance: string;
  readonly verifiable: boolean;
  readonly displayName: string;
  readonly observedExternalVersion: string;
  readonly unavailableReason: string;
}

const blankSource = (): SourceDraftInput => ({
  kind: 'text',
  content: '',
  targetUrl: '',
  provenance: '',
  verifiable: false,
  displayName: '',
  observedExternalVersion: '',
  unavailableReason: '',
});

function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function sourceInput(input: SourceDraftInput): SourceInput {
  const displayName = optional(input.displayName);
  if (input.kind === 'link') {
    const observedExternalVersion = optional(input.observedExternalVersion);
    const unavailableReason = optional(input.unavailableReason);
    return {
      kind: 'link',
      targetUrl: input.targetUrl,
      provenance: input.provenance,
      verifiable: input.verifiable,
      ...(displayName === undefined ? {} : { displayName }),
      ...(observedExternalVersion === undefined ? {} : { observedExternalVersion }),
      ...(unavailableReason === undefined ? {} : { unavailableReason }),
    };
  }
  return {
    kind: input.kind,
    content: input.content,
    provenance: input.provenance,
    ...(displayName === undefined ? {} : { displayName }),
  };
}

function SourceContent({ source }: { readonly source: ContextSourceView }) {
  if (source.kind === 'link') {
    return (
      <div>
        <code className="source-url">{source.targetUrl}</code>
        {source.observedExternalVersion !== undefined && <p>관찰한 외부 버전: {source.observedExternalVersion}</p>}
        {source.unavailableReason !== undefined && <p>확인 불가 이유: {source.unavailableReason}</p>}
      </div>
    );
  }
  if (source.kind === 'markdown') {
    return <div className="markdown-content"><SafeMarkdown>{source.content}</SafeMarkdown></div>;
  }
  return <pre className="source-text">{source.content}</pre>;
}

interface ConfirmationDraftInput {
  readonly confirmationEvidence: string;
}

interface ConfirmationBasis {
  readonly sourceVersionRef: ContextSourceVersionRef;
  readonly revision: number;
}

function SourceConfirmationForm({ actorId, projectId, srId, source, actorName, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly srId: string;
  readonly source: ContextSourceView;
  readonly actorName: (actorId: string) => string;
  onSaved(): void;
}) {
  const draft = useMemo(() => new FormDraft<ConfirmationDraftInput, ConfirmationBasis>(
    { actorId, scope: { kind: 'sr', projectId, srId }, target: source.sourceId, form: 'source-confirmation' },
    { confirmationEvidence: '' },
    { sourceVersionRef: source.currentVersionRef, revision: source.revision },
  ), [actorId, projectId, srId, source.sourceId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, source.sourceId]);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    draft.refreshFromServer(
      { confirmationEvidence: '' },
      { sourceVersionRef: source.currentVersionRef, revision: source.revision },
    );
    setSnapshot(draft.snapshot());
  }, [draft, source.currentVersionRef, source.revision]);

  const inputFrom = (value: typeof snapshot): SourceConfirmation => ({
    sourceVersionRef: value.basis.sourceVersionRef,
    confirmationEvidence: value.input.confirmationEvidence,
  });

  const execute = async (attempt: CommandAttempt<SourceConfirmation, RevisionGuard<'context_source'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-007', {
        actorId, projectId, srId, guard: attempt.submission.guard,
        idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId,
        scope: { kind: 'sr', projectId, srId },
        target: source.sourceId,
        command: 'M-007',
      });
      if (!resolution.appliesToCurrentForm) return;
      if (JSON.stringify(inputFrom(draft.snapshot())) !== JSON.stringify(attempt.submission.input)) {
        setFeedback(resolution.result.kind === 'rejected'
          ? { kind: 'idle' }
          : { kind: 'committed', message: '이전 확인 결과를 확인했습니다. 현재 편집은 유지했습니다.' });
        return;
      }
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        return;
      }
      const confirmed = resolution.result.value;
      draft.markSaved(
        { confirmationEvidence: '' },
        { sourceVersionRef: confirmed.currentVersionRef, revision: confirmed.revision },
      );
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 기록된 사람 확인 결과를 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '근거 확인을 기록했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else {
        setFeedback({ kind: 'rejected', error: {
          code: 'STORE_UNAVAILABLE',
          message: error instanceof Error ? error.message : '근거 확인을 기록하지 못했습니다.',
          blockers: [], assigneeIds: [], targetRefs: [],
        } });
      }
    } finally {
      session.endExecution(attempt);
    }
  };

  const submit = () => {
    const current = draft.snapshot();
    const guard: RevisionGuard<'context_source'> = { resource: {
      target: { kind: 'context_source', projectId, srId, entityId: source.sourceId },
      expectedRevision: current.basis.revision,
    } };
    const attempt = session.submit({
      actorId,
      scope: { kind: 'sr', projectId, srId },
      target: source.sourceId,
      command: 'M-007',
      input: inputFrom(current),
      guard,
    });
    void execute(attempt);
  };

  const discardConfirmationDraft = () => {
    if (!draft.discardToLatest(snapshot.identity)) return;
    setSnapshot(draft.snapshot());
    setFeedback({ kind: 'idle' });
  };

  return (
    <div className="source-confirmation">
      {source.confirmation === 'confirmed' && (
        <div className="confirmation-record">
          <p><strong>확인자:</strong> {actorName(source.confirmedBy)}</p>
          <p><strong>확인 시각:</strong> <time dateTime={source.confirmedAt}>{source.confirmedAt}</time></p>
          <p><strong>사람 확인 근거:</strong> {source.confirmationEvidence}</p>
        </div>
      )}
      {source.confirmation === 'confirmed' && snapshot.dirty ? (
        <div className="draft-comparison" role="status">
          <p><strong>작성 중인 확인 근거:</strong> {snapshot.input.confirmationEvidence}</p>
          <p>이 source는 다른 요청에서 이미 확인됐습니다. 위 실제 확인 기록과 작성 중 입력을 비교해 폐기할 수 있습니다.</p>
          {snapshot.latestServer !== undefined && <button type="button" onClick={discardConfirmationDraft}>작성 중 확인 근거 폐기</button>}
        </div>
      ) : source.confirmation === 'unconfirmed' ? (
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label>사람 확인 근거<textarea required value={snapshot.input.confirmationEvidence} onChange={(event) => {
            draft.edit({ confirmationEvidence: event.target.value });
            setSnapshot(draft.snapshot());
          }} /></label>
          <button type="submit">사람 확인 기록</button>
          {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 확인 근거가 있습니다.</p>}
        </form>
      ) : null}
      <CommandFeedback state={feedback} />
    </div>
  );
}

export function SourcePanel({ actorId, projectId, srId, srRevision, sources, actorName, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly srId: string;
  readonly srRevision: number;
  readonly sources: readonly ContextSourceView[];
  readonly actorName: (actorId: string) => string;
  onSaved(): void;
}) {
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: { kind: 'sr' as const, projectId, srId }, target: 'source:new', form: 'source-add' },
    blankSource(),
    { revision: srRevision },
  ), [actorId, projectId, srId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId]);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    draft.refreshFromServer(blankSource(), { revision: srRevision });
    setSnapshot(draft.snapshot());
  }, [draft, srRevision]);

  const edit = (patch: Partial<SourceDraftInput>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };

  const execute = async (attempt: CommandAttempt<SourceInput, RevisionGuard<'sr'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-006', {
        actorId, projectId, srId, guard: attempt.submission.guard,
        idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId,
        scope: { kind: 'sr', projectId, srId },
        target: 'source:new',
        command: 'M-006',
      });
      if (!resolution.appliesToCurrentForm) return;
      if (JSON.stringify(sourceInput(draft.snapshot().input)) !== JSON.stringify(attempt.submission.input)) {
        setFeedback(resolution.result.kind === 'rejected'
          ? { kind: 'idle' }
          : { kind: 'committed', message: '이전 근거의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.' });
        return;
      }
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        return;
      }
      draft.markSaved(blankSource(), draft.snapshot().basis);
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 근거를 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '근거를 추가했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else {
        setFeedback({ kind: 'rejected', error: {
          code: 'STORE_UNAVAILABLE',
          message: error instanceof Error ? error.message : '근거를 저장하지 못했습니다.',
          blockers: [], assigneeIds: [], targetRefs: [],
        } });
      }
    } finally {
      session.endExecution(attempt);
    }
  };

  const submit = () => {
    const current = draft.snapshot();
    const guard: RevisionGuard<'sr'> = { resource: {
      target: { kind: 'sr', projectId, srId, entityId: srId },
      expectedRevision: current.basis.revision,
    } };
    const attempt = session.submit({
      actorId,
      scope: { kind: 'sr', projectId, srId },
      target: 'source:new',
      command: 'M-006',
      input: sourceInput(current.input),
      guard,
    });
    void execute(attempt);
  };

  const adoptLatestBasis = () => {
    if (!draft.adoptLatestBasis(snapshot.identity)) return;
    setSnapshot(draft.snapshot());
    setFeedback({ kind: 'idle' });
  };

  const discardToLatest = () => {
    if (!draft.discardToLatest(snapshot.identity)) return;
    setSnapshot(draft.snapshot());
    setFeedback({ kind: 'idle' });
  };

  return (
    <section className="source-summary" aria-labelledby="source-panel-title">
      <h3 id="source-panel-title">근거</h3>
      {sources.length === 0 ? <p>연결된 근거가 없습니다.</p> : (
        <div className="source-list">{sources.map((source) => (
          <article className="source-item" data-testid={`context-source-${source.sourceId}`} key={source.sourceId}>
            <div className="source-heading">
              <h4>{source.displayName ?? `${source.kind} 근거`}</h4>
              <span>{source.confirmation === 'confirmed' ? '사람 확인 완료' : '사람 확인 전'}</span>
              {source.kind === 'link' && <span>{source.verifiable ? '확인 가능' : '확인 불가'}</span>}
            </div>
            <SourceContent source={source} />
            <p>출처: {source.provenance}</p>
            <small>현재 근거 version {source.currentVersionRef.version}</small>
            <SourceConfirmationForm actorId={actorId} projectId={projectId} srId={srId} source={source} actorName={actorName} onSaved={onSaved} />
          </article>
        ))}</div>
      )}
      <form className="source-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>근거 종류<select value={snapshot.input.kind} onChange={(event) => edit({ kind: event.target.value as SourceDraftInput['kind'] })}><option value="text">텍스트</option><option value="markdown">Markdown</option><option value="link">링크</option></select></label>
        <label>근거 표시 이름<input value={snapshot.input.displayName} onChange={(event) => edit({ displayName: event.target.value })} /></label>
        <label>근거 출처<textarea required value={snapshot.input.provenance} onChange={(event) => edit({ provenance: event.target.value })} /></label>
        {snapshot.input.kind === 'link' ? <>
          <label>근거 URL<input required type="url" value={snapshot.input.targetUrl} onChange={(event) => edit({ targetUrl: event.target.value })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={snapshot.input.verifiable} onChange={(event) => edit({ verifiable: event.target.checked })} />원문 확인 가능</label>
          <label>관찰한 외부 버전<input value={snapshot.input.observedExternalVersion} onChange={(event) => edit({ observedExternalVersion: event.target.value })} /></label>
          <label>확인 불가 이유<textarea value={snapshot.input.unavailableReason} onChange={(event) => edit({ unavailableReason: event.target.value })} /></label>
        </> : <label>근거 본문<textarea required rows={6} value={snapshot.input.content} onChange={(event) => edit({ content: event.target.value })} /></label>}
        <button className="primary-button" type="submit">근거 추가</button>
      </form>
      {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 근거가 있습니다. 새 조회가 이 입력을 덮어쓰지 않습니다.</p>}
      {snapshot.latestServer !== undefined && (
        <div className="draft-comparison" role="status">
          <p><strong>최신 SR revision {snapshot.latestServer.basis.revision}</strong></p>
          <p>현재 작성 기준은 revision {snapshot.basis.revision}입니다. 입력을 유지한 채 최신 기준을 채택하거나 입력을 폐기할 수 있습니다.</p>
          <div className="draft-actions">
            <button type="button" onClick={adoptLatestBasis}>최신 SR 기준으로 계속 작성</button>
            <button type="button" onClick={discardToLatest}>작성 중 근거 폐기</button>
          </div>
        </div>
      )}
      <CommandFeedback state={feedback} />
    </section>
  );
}
