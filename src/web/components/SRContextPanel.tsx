import { useEffect, useMemo, useRef, useState } from 'react';
import type { RevisionGuard } from '@/src/contracts/context';
import type { SRDescriptionEdit, SRDetailView } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import { SourcePanel } from './SourcePanel';

function fromDetail(detail: SRDetailView): SRDescriptionEdit {
  return {
    title: detail.currentDescription.title,
    purpose: detail.currentDescription.purpose,
    description: detail.currentDescription.description,
    changeReason: '',
  };
}

export function SRContextPanel({ actorId, projectId, detail, actorName, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly actorName: (actorId: string) => string;
  onSaved(): void;
}) {
  const srId = detail.sr.scope.srId;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: detail.sr.scope, target: srId, form: 'sr-description' },
    fromDetail(detail),
    { revision: detail.sr.revision },
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
    draft.refreshFromServer(fromDetail(detail), { revision: detail.sr.revision });
    setSnapshot(draft.snapshot());
  }, [detail, draft]);

  const edit = (patch: Partial<SRDescriptionEdit>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };

  const execute = async (attempt: CommandAttempt<SRDescriptionEdit, RevisionGuard<'sr'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-005', {
        actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId, scope: detail.sr.scope, target: srId, command: 'M-005',
      });
      if (!resolution.appliesToCurrentForm) return;
      if (JSON.stringify(draft.snapshot().input) !== JSON.stringify(attempt.submission.input)) {
        setFeedback(resolution.result.kind === 'rejected'
          ? { kind: 'idle' }
          : { kind: 'committed', message: '이전 설명의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.' });
        return;
      }
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        return;
      }
      const nextRevision = resolution.result.value.revision;
      draft.markSaved(attempt.submission.input, { revision: nextRevision });
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '과거 저장 결과와 현재 기준을 함께 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '현재 설명을 저장했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({
          kind: 'confirmation-required',
          retry: () => { void execute(session.retry(attempt)); },
        });
        return;
      }
      setFeedback({ kind: 'rejected', error: {
        code: 'STORE_UNAVAILABLE',
        message: error instanceof Error ? error.message : '설명을 저장하지 못했습니다.',
        blockers: [], assigneeIds: [], targetRefs: [],
      } });
    } finally {
      session.endExecution(attempt);
    }
  };

  const submit = () => {
    const current = draft.snapshot();
    const guard: RevisionGuard<'sr'> = {
      resource: {
        target: { kind: 'sr', projectId, srId, entityId: srId },
        expectedRevision: current.basis.revision,
      },
    };
    const attempt = session.submit({
      actorId,
      scope: detail.sr.scope,
      target: srId,
      command: 'M-005',
      input: current.input,
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
    <section className="context-panel" aria-labelledby="context-panel-title">
      <div className="section-heading">
        <div><p className="eyebrow">SR 맥락</p><h2 id="context-panel-title">설명과 근거</h2></div>
      </div>
      <details>
        <summary>최초 설명 보기</summary>
        <div className="document-block"><h3>{detail.originalDescription.title}</h3><p>{detail.originalDescription.purpose}</p><pre>{detail.originalDescription.description}</pre></div>
      </details>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>현재 제목<input value={snapshot.input.title} onChange={(event) => edit({ title: event.target.value })} /></label>
        <label>현재 목적<textarea value={snapshot.input.purpose} onChange={(event) => edit({ purpose: event.target.value })} /></label>
        <label>현재 설명<textarea data-testid="sr-context-description-input" rows={10} value={snapshot.input.description} onChange={(event) => edit({ description: event.target.value })} /></label>
        <label>변경 이유<input required value={snapshot.input.changeReason} onChange={(event) => edit({ changeReason: event.target.value })} /></label>
        <button className="primary-button" type="submit">설명 저장</button>
      </form>
      {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 설명이 있습니다. 새 조회가 이 입력을 덮어쓰지 않습니다.</p>}
      {snapshot.latestServer !== undefined && (
        <div className="draft-comparison" role="status">
          <p><strong>최신 설명 · SR revision {snapshot.latestServer.basis.revision}</strong></p>
          <dl>
            <div><dt>제목</dt><dd>{snapshot.latestServer.input.title}</dd></div>
            <div><dt>목적</dt><dd>{snapshot.latestServer.input.purpose}</dd></div>
            <div><dt>설명</dt><dd><pre>{snapshot.latestServer.input.description}</pre></dd></div>
          </dl>
          <div className="draft-actions">
            <button type="button" onClick={adoptLatestBasis}>최신 설명 기준으로 계속 작성</button>
            <button type="button" onClick={discardToLatest}>작성 중 설명 폐기</button>
          </div>
        </div>
      )}
      <CommandFeedback state={feedback} />
      <SourcePanel actorId={actorId} projectId={projectId} srId={srId} srRevision={detail.sr.revision} sources={detail.sources} actorName={actorName} onSaved={onSaved} />
    </section>
  );
}
