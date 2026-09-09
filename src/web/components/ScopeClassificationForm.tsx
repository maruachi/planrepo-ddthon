import { useEffect, useMemo, useRef, useState } from 'react';
import type { RevisionGuard, VersionRef } from '@/src/contracts/context';
import type {
  ArtifactView,
  DecisionView,
  QuestionView,
  ScopeClassification,
  ScopeView,
} from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';

type Classifiable = QuestionView | DecisionView;

interface ScopeDraft {
  readonly scope: 'current' | 'followup';
  readonly requiredGate: 'G1' | 'G2';
  readonly reason: string;
  readonly ownerId: string;
  readonly revisitKind: 'event' | 'at';
  readonly revisitValue: string;
  readonly decisionBasisKey: string;
  readonly requirementsBasisKey: string;
}

interface ScopeBasis {
  readonly revision: number;
  readonly classificationVersion: number;
  readonly scope: 'current' | 'followup';
}

interface MemberOption {
  readonly actorId: string;
  readonly displayName: string;
}

function refKey(ref: VersionRef): string {
  return `${ref.kind}:${ref.entityId}:${ref.version}`;
}

function blankScope(target: Classifiable, members: readonly MemberOption[]): ScopeDraft {
  const classification = target.currentClassification;
  return {
    scope: classification.scope,
    requiredGate: classification.scope === 'current' ? classification.requiredGate : 'G1',
    reason: classification.reason,
    ownerId: classification.scope === 'followup' ? classification.ownerId : (members[0]?.actorId ?? ''),
    revisitKind: classification.scope === 'followup' ? classification.revisit.kind : 'event',
    revisitValue: classification.scope === 'followup'
      ? (classification.revisit.kind === 'event' ? classification.revisit.event : classification.revisit.at.slice(0, 16))
      : '',
    decisionBasisKey: '',
    requirementsBasisKey: '',
  };
}

function scopeBasis(target: Classifiable): ScopeBasis {
  return {
    revision: target.revision,
    classificationVersion: target.classificationRef.version,
    scope: target.currentClassification.scope,
  };
}

function errorValue(error: unknown) {
  return {
    code: 'STORE_UNAVAILABLE' as const,
    message: error instanceof Error ? error.message : '범위 분류를 저장하지 못했습니다.',
    blockers: [], assigneeIds: [], targetRefs: [],
  };
}

export function ScopeClassificationForm({
  actorId, projectId, ownerId, target, members, artifacts, decisions, onSaved,
}: {
  readonly actorId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly target: Classifiable;
  readonly members: readonly MemberOption[];
  readonly artifacts: readonly ArtifactView[];
  readonly decisions: readonly DecisionView[];
  onSaved(): void;
}) {
  const srId = target.scope.srId;
  const targetId = 'questionId' in target ? target.questionId : target.decisionId;
  const targetKind = 'questionId' in target ? 'question' as const : 'decision' as const;
  const identity = `${actorId}:${projectId}:${srId}:${targetKind}:${targetId}:M-014`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: target.scope, target: targetId, form: 'scope-classification' },
    blankScope(target, members), scopeBasis(target),
  ), [actorId, projectId, srId, targetKind, targetId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, targetKind, targetId]);
  const mounted = useRef(false);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  const confirmedDecisions = decisions.filter((decision) => decision.currentConfirmation !== undefined);
  const requirements = artifacts.filter((artifact) => artifact.kind === 'requirements');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    draft.refreshFromServer(blankScope(target, members), scopeBasis(target));
    setSnapshot(draft.snapshot());
  }, [draft, target, members]);

  const edit = (patch: Partial<ScopeDraft>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };

  const buildInput = (inputDraft: ScopeDraft, basisScope: ScopeBasis['scope']): ScopeClassification | undefined => {
    const targetRef = { kind: targetKind, projectId, srId, entityId: targetId };
    if (inputDraft.scope === 'current') {
      return { targetRef, scope: 'current', requiredGate: inputDraft.requiredGate, reason: inputDraft.reason };
    }
    const basisRefs: VersionRef[] = [];
    if (basisScope === 'current') {
      const decision = confirmedDecisions.find((candidate) =>
        candidate.currentConfirmation !== undefined && refKey(candidate.currentConfirmation.ref) === inputDraft.decisionBasisKey);
      const requirement = requirements.find((candidate) => refKey(candidate.versionRef) === inputDraft.requirementsBasisKey);
      if (decision === undefined || decision.currentConfirmation === undefined || requirement === undefined) return undefined;
      basisRefs.push(decision.currentConfirmation.ref, requirement.versionRef);
    }
    const revisit = inputDraft.revisitKind === 'event'
      ? { kind: 'event' as const, event: inputDraft.revisitValue }
      : { kind: 'at' as const, at: new Date(inputDraft.revisitValue).toISOString() };
    return {
      targetRef, scope: 'followup', requiredGate: 'None', reason: inputDraft.reason,
      ownerId: inputDraft.ownerId, revisit,
      ...(basisRefs.length === 0 ? {} : { basisRefs }),
    };
  };

  const execute = async (attempt: CommandAttempt<ScopeClassification, RevisionGuard<'question' | 'decision'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-014', {
        actorId, projectId, srId, guard: attempt.submission.guard,
        idempotencyKey: attempt.idempotencyKey,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId, scope: target.scope, target: targetId, command: 'M-014',
      });
      if (!resolution.appliesToCurrentForm || currentIdentity.current !== identity) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      const liveInput = buildInput(draft.snapshot().input, draft.snapshot().basis.scope);
      if (liveInput === undefined || JSON.stringify(liveInput) !== JSON.stringify(attempt.submission.input)) {
        setFeedback({ kind: 'committed', message: '이전 범위 저장 결과를 반영했습니다. 현재 편집은 유지했습니다.' });
        onSaved();
        return;
      }
      const value: ScopeView = resolution.result.value;
      draft.markSaved(draft.snapshot().input, {
        revision: value.revision,
        classificationVersion: value.classificationRef.version,
        scope: value.scope,
      });
      setSnapshot(draft.snapshot());
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 범위 분류를 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '범위 분류를 저장했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: errorValue(error) });
    } finally { session.endExecution(attempt); }
  };

  const submit = () => {
    const current = draft.snapshot();
    const input = buildInput(current.input, current.basis.scope);
    if (input === undefined) return;
    const targetRef = input.targetRef;
    const guard: RevisionGuard<'question' | 'decision'> = { resource: {
      target: targetRef, expectedRevision: current.basis.revision,
    } };
    void execute(session.submit({
      actorId, scope: target.scope, target: targetId, command: 'M-014', input, guard,
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

  const classification = target.currentClassification;
  const canEdit = !('questionId' in target && target.status === 'converted_to_decision');
  return <div className="scope-classification">
    <div className="answer-record">
      <strong>현재 범위 분류</strong>
      <p>{classification.scope === 'current' ? `현재 업무 · ${classification.requiredGate}` : '후속 업무 · 게이트 없음'}</p>
      <p>{classification.reason}</p>
      {classification.scope === 'followup' && <small>
        담당 {members.find((member) => member.actorId === classification.ownerId)?.displayName ?? classification.ownerId}
        {' · '}{classification.revisit.kind === 'event' ? classification.revisit.event : classification.revisit.at}
      </small>}
      <small>분류자 {classification.classifiedBy} · {classification.classifiedAt} · v{classification.ref.version}</small>
      {classification.previousVersionRef !== undefined && <small>이전 분류 v{classification.previousVersionRef.version}</small>}
      {classification.basisRefs.length > 0 && <ul>{classification.basisRefs.map((ref) =>
        <li key={refKey(ref)}>{ref.kind} · {ref.entityId} · v{ref.version}</li>)}</ul>}
    </div>
    {actorId === ownerId && canEdit && <>
      <button className="text-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>범위 변경</button>
      {open && <div className="entity-form"><form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>업무 범위<select value={snapshot.input.scope} onChange={(event) => edit({ scope: event.target.value as ScopeDraft['scope'] })}><option value="current">현재 업무</option><option value="followup">후속 업무</option></select></label>
        {snapshot.input.scope === 'current' ? <label>필요 게이트<select value={snapshot.input.requiredGate} onChange={(event) => edit({ requiredGate: event.target.value as ScopeDraft['requiredGate'] })}><option value="G1">G1</option><option value="G2">G2</option></select></label> : <>
          <label>후속 담당자<select required value={snapshot.input.ownerId} onChange={(event) => edit({ ownerId: event.target.value })}>{members.map((member) => <option key={member.actorId} value={member.actorId}>{member.displayName}</option>)}</select></label>
          <label>재검토 조건<select value={snapshot.input.revisitKind} onChange={(event) => edit({ revisitKind: event.target.value as ScopeDraft['revisitKind'], revisitValue: '' })}><option value="event">사건</option><option value="at">시각</option></select></label>
          <label>{snapshot.input.revisitKind === 'event' ? '재검토 사건' : '재검토 시각'}<input required type={snapshot.input.revisitKind === 'at' ? 'datetime-local' : 'text'} value={snapshot.input.revisitValue} onChange={(event) => edit({ revisitValue: event.target.value })} /></label>
          {snapshot.basis.scope === 'current' && <>
            <label>범위 축소 결정<select required value={snapshot.input.decisionBasisKey} onChange={(event) => edit({ decisionBasisKey: event.target.value })}><option value="">선택하세요</option>{confirmedDecisions.map((decision) => <option key={decision.decisionId} value={refKey(decision.currentConfirmation!.ref)}>{decision.prompt} · v{decision.currentConfirmation!.ref.version}</option>)}</select></label>
            <label>현재 요구사항<select required value={snapshot.input.requirementsBasisKey} onChange={(event) => edit({ requirementsBasisKey: event.target.value })}><option value="">선택하세요</option>{requirements.map((artifact) => <option key={artifact.artifactId} value={refKey(artifact.versionRef)}>{artifact.changeSummary} · v{artifact.versionRef.version}</option>)}</select></label>
          </>}
        </>}
        <label>분류 이유<textarea required value={snapshot.input.reason} onChange={(event) => edit({ reason: event.target.value })} /></label>
        <button className="primary-button" type="submit">범위 저장</button>
      </form>
      {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 범위 입력이 있습니다.</p>}
      {snapshot.latestServer !== undefined && <div className="draft-comparison" role="status"><p>최신 분류 revision {snapshot.latestServer.basis.revision}을 확인했습니다.</p><div className="draft-actions"><button type="button" onClick={adoptLatest}>최신 범위 기준으로 계속 작성</button><button type="button" onClick={discardLatest}>작성 중 범위 폐기</button></div></div>}
      <CommandFeedback state={feedback} />
      </div>}
    </>}
  </div>;
}
