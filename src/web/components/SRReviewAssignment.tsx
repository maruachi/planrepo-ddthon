import { useEffect, useMemo, useRef, useState } from 'react';
import type { PolicyApplicationGuard, RevisionGuard } from '@/src/contracts/context';
import type { DemoActorView, PolicyApplication, PolicyView, ReviewerAssignment, ReviewConfigurationView, SRDetailView } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';

const GATES = ['G1', 'G2'] as const;
const REQUIREMENTS_GATES = ['G1'] as const;
type Gate = (typeof GATES)[number];

function gateLabel(gate: Gate, inceptionOnly = false): string {
  return inceptionOnly && gate === 'G1' ? 'Plan 검토' : gate === 'G1' ? '요구사항 검토' : '계획 검토';
}

function localError(error: unknown, fallback: string) {
  return { code: 'STORE_UNAVAILABLE' as const, message: error instanceof Error ? error.message : fallback, blockers: [], assigneeIds: [], targetRefs: [] };
}

interface AssignmentDraft { readonly reviewerIds: readonly string[]; readonly changeReason: string }
interface AssignmentBasis { readonly revision: number; readonly assignmentKey: string }

function assignmentDraft(configuration: ReviewConfigurationView): AssignmentDraft {
  return { reviewerIds: configuration.assignment?.reviewerIds ?? [], changeReason: '' };
}
function assignmentBasis(configuration: ReviewConfigurationView): AssignmentBasis {
  const ref = configuration.assignment?.assignmentRef;
  return { revision: configuration.revision, assignmentKey: ref === undefined ? 'absent' : `${ref.entityId}:${ref.version}` };
}

function GateAssignment({ actorId, projectId, srId, gate, configuration, preparation, members, inceptionOnly, onSaved }: {
  readonly actorId: string; readonly projectId: string; readonly srId: string; readonly gate: Gate;
  readonly configuration: ReviewConfigurationView;
  readonly preparation: SRDetailView['reviewPreparations'][number] | undefined;
  readonly members: readonly DemoActorView[];
  readonly inceptionOnly: boolean;
  onSaved(): void;
}) {
  const gateLabel = inceptionOnly && gate === 'G1' ? 'Plan' : gate === 'G1' ? '요구사항' : '계획';
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: { kind: 'sr', projectId, srId }, target: gate, form: 'reviewer-assignment' },
    assignmentDraft(configuration), assignmentBasis(configuration),
  ), [actorId, projectId, srId, gate]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId, gate]);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { draft.refreshFromServer(assignmentDraft(configuration), assignmentBasis(configuration)); setSnapshot(draft.snapshot()); }, [configuration, draft]);

  const toggle = (id: string, checked: boolean) => {
    const selected = new Set(draft.snapshot().input.reviewerIds);
    if (checked) selected.add(id); else selected.delete(id);
    draft.edit({ ...draft.snapshot().input, reviewerIds: [...selected].sort() });
    setSnapshot(draft.snapshot());
  };

  const execute = async (attempt: CommandAttempt<ReviewerAssignment, RevisionGuard<'review_gate_state'>>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-030', { actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), { actorId, scope: { kind: 'sr', projectId, srId }, target: gate, command: 'M-030' });
      if (!resolution.appliesToCurrentForm) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      const live = draft.snapshot().input;
      const submittedReason = 'changeReason' in attempt.submission.input ? attempt.submission.input.changeReason : '';
      const changed = JSON.stringify(live.reviewerIds) !== JSON.stringify(attempt.submission.input.reviewerIds) ||
        live.changeReason !== submittedReason;
      if (!changed) {
        draft.markSaved({ reviewerIds: resolution.result.value.reviewerIds, changeReason: '' }, {
          revision: snapshot.basis.revision + 1,
          assignmentKey: `${resolution.result.value.assignmentRef.entityId}:${resolution.result.value.assignmentRef.version}`,
        });
        setSnapshot(draft.snapshot());
      }
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: `이미 저장된 ${gateLabel} 배정을 확인했습니다.`, receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: changed ? `이전 ${gateLabel} 배정을 저장했습니다. 현재 선택은 유지했습니다.` : `${gateLabel} 배정을 저장했습니다.` });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error, `${gateLabel} 배정을 저장하지 못했습니다.`) });
    } finally { session.endExecution(attempt); }
  };

  const submit = () => {
    const current = draft.snapshot();
    if (configuration.assignment !== undefined && current.input.changeReason.trim() === '') {
      setFeedback({ kind: 'rejected', error: { code: 'VALIDATION_ERROR', message: '현재 배정을 바꾸는 이유를 입력해 주세요.', blockers: [], assigneeIds: [], targetRefs: [] } });
      return;
    }
    const input: ReviewerAssignment = configuration.assignment === undefined
      ? { gate, reviewerIds: current.input.reviewerIds }
      : { gate, reviewerIds: current.input.reviewerIds, previousAssignmentRef: configuration.assignment.assignmentRef, changeReason: current.input.changeReason };
    const guard: RevisionGuard<'review_gate_state'> = { resource: { target: { kind: 'review_gate_state', projectId, srId, entityId: gate }, expectedRevision: current.basis.revision } };
    void execute(session.submit({ actorId, scope: { kind: 'sr', projectId, srId }, target: gate, command: 'M-030', input, guard }));
  };

  return <fieldset className="assignment-gate"><legend>{gateLabel} 검토자</legend>
    <p className="quiet">{configuration.assignment === undefined ? '아직 배정되지 않았습니다.' : configuration.assignment.ready ? '배정 준비 완료' : `준비 부족: ${configuration.assignment.notReadyReason ?? (inceptionOnly ? 'Plan 검토 기준을 충족하지 않습니다.' : '정책 기준을 충족하지 않습니다.')}`}</p>
    <p className="quiet">{inceptionOnly ? 'Plan을 함께 확인할 동료를 선택합니다. Plan이 준비되면 담당자가 검토를 요청합니다.' : '내용을 함께 확인할 동료를 선택합니다. 문서가 준비되면 담당자가 검토를 요청합니다.'}</p>
    {members.map((member) => <label className="checkbox-label" key={member.actorId}><input type="checkbox" aria-label={`${gateLabel} 검토자 ${member.displayName}`} checked={snapshot.input.reviewerIds.includes(member.actorId)} onChange={(event) => toggle(member.actorId, event.target.checked)} />{member.displayName}</label>)}
    {configuration.assignment !== undefined && <label>배정 변경 이유<textarea value={snapshot.input.changeReason} onChange={(event) => { draft.edit({ ...draft.snapshot().input, changeReason: event.target.value }); setSnapshot(draft.snapshot()); }} /></label>}
    {snapshot.dirty && <span className="dirty-indicator">저장하지 않은 검토자 선택이 있습니다.</span>}
    {snapshot.latestServer !== undefined && <div className="draft-comparison"><p>서버의 최신 배정 기준이 바뀌었습니다.</p><div className="draft-actions"><button type="button" onClick={() => { if (draft.adoptLatestBasis(snapshot.identity)) setSnapshot(draft.snapshot()); }}>현재 선택에 최신 기준 사용</button><button type="button" onClick={() => { if (draft.discardToLatest(snapshot.identity)) setSnapshot(draft.snapshot()); }}>내 선택 폐기</button></div></div>}
    <button type="button" onClick={submit}>{gateLabel} 검토자 저장</button><CommandFeedback state={feedback} />
  </fieldset>;
}

function PolicyApplicationForm({ actorId, projectId, srId, configurations, policies, availableGates, inceptionOnly, onSaved }: {
  readonly actorId: string; readonly projectId: string; readonly srId: string;
  readonly configurations: readonly ReviewConfigurationView[]; readonly policies: readonly PolicyView[];
  readonly availableGates: readonly Gate[];
  readonly inceptionOnly: boolean;
  onSaved(): void;
}) {
  const [policyKey, setPolicyKey] = useState(() => policies.at(-1) === undefined ? '' : `${policies.at(-1)!.policyRef.entityId}:${policies.at(-1)!.policyRef.version}`);
  const [gates, setGates] = useState<Gate[]>(() => [...availableGates]);
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });
  const session = useMemo(() => new CommandSession(), [actorId, projectId, srId]);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setGates((current) => {
      const visible = current.filter((gate) => availableGates.includes(gate));
      return visible.length === current.length ? current : visible;
    });
  }, [availableGates]);

  const execute = async (attempt: CommandAttempt<PolicyApplication, PolicyApplicationGuard>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-031', { actorId, projectId, srId, guard: attempt.submission.guard, idempotencyKey: attempt.idempotencyKey }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), { actorId, scope: { kind: 'sr', projectId, srId }, target: 'review-policy', command: 'M-031' });
      if (!resolution.appliesToCurrentForm) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: inceptionOnly ? '이미 적용된 Plan 검토 기준을 확인했습니다.' : '이미 적용된 정책을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: `${attempt.submission.input.gates.map((gate) => gateLabel(gate, inceptionOnly)).join('과 ')}에 검토 기준을 적용했습니다.` });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error, inceptionOnly ? 'Plan 검토 기준을 적용하지 못했습니다.' : '정책을 적용하지 못했습니다.') });
    } finally { session.endExecution(attempt); }
  };

  const submit = () => {
    const policy = policies.find((item) => `${item.policyRef.entityId}:${item.policyRef.version}` === policyKey);
    const ordered = availableGates.filter((gate) => gates.includes(gate));
    if (policy === undefined || ordered.length === 0) { setFeedback({ kind: 'rejected', error: { code: 'VALIDATION_ERROR', message: inceptionOnly ? 'Plan 검토 기준을 선택해 주세요.' : '정책과 적용할 검토 단계를 선택해 주세요.', blockers: [], assigneeIds: [], targetRefs: [] } }); return; }
    const input: PolicyApplication = { policyRef: policy.policyRef, gates: ordered as [Gate, ...Gate[]] };
    const guard: PolicyApplicationGuard = { resources: ordered.map((gate) => ({ target: { kind: 'review_gate_state', projectId, srId, entityId: gate }, expectedRevision: configurations.find((item) => item.gate === gate)?.revision ?? -1 })) };
    void execute(session.submit({ actorId, scope: { kind: 'sr', projectId, srId }, target: 'review-policy', command: 'M-031', input, guard }));
  };
  return <fieldset className="policy-application"><legend>{inceptionOnly ? 'Plan 검토 기준 적용' : 'SR 정책 적용'}</legend><label>{inceptionOnly ? '검토 기준' : '적용 정책'}<select value={policyKey} onChange={(event) => setPolicyKey(event.target.value)}>{policies.map((policy) => <option key={`${policy.policyRef.entityId}:${policy.policyRef.version}`} value={`${policy.policyRef.entityId}:${policy.policyRef.version}`}>{policy.description ?? policy.policyRef.entityId} v{policy.policyRef.version}</option>)}</select></label>
    <div className="gate-checks">{availableGates.map((gate) => <label className="checkbox-label" key={gate}><input type="checkbox" checked={gates.includes(gate)} onChange={(event) => setGates((current) => event.target.checked ? [...new Set([...current, gate])] : current.filter((item) => item !== gate))} />{gateLabel(gate, inceptionOnly)}</label>)}</div>
    <p className="quiet">{inceptionOnly ? '선택한 기준을 현재 Plan 검토에 적용합니다.' : '선택한 단계에 이 검토 기준을 적용합니다.'}</p>
    <button type="button" onClick={submit}>{inceptionOnly ? 'Plan 검토 기준 적용' : '선택한 단계에 적용'}</button><CommandFeedback state={feedback} />
  </fieldset>;
}

export function SRReviewAssignment({ actorId, projectId, detail, members, policies, inceptionOnly = false, onSaved }: {
  readonly actorId: string; readonly projectId: string; readonly detail: SRDetailView;
  readonly members: readonly DemoActorView[]; readonly policies: readonly PolicyView[];
  readonly inceptionOnly?: boolean;
  onSaved(): void;
}) {
  const actor = members.find((member) => member.actorId === actorId);
  const canApplyPolicy = actor?.roles.includes('team_admin') === true;
  const canAssign = actor !== undefined && (
    canApplyPolicy || detail.sr.ownerId === actorId || detail.originalDescription.authorId === actorId
  );
  const availableGates: readonly Gate[] = inceptionOnly || detail.sr.progressStage === 'sr_received' || detail.sr.progressStage === 'requirements'
    ? REQUIREMENTS_GATES
    : GATES;
  return <section className="entity-panel review-assignment" aria-label={inceptionOnly ? 'Plan 검토자와 검토 기준' : '검토자와 정책 배정'}><p className="eyebrow">{inceptionOnly ? 'Plan 검토 준비' : 'SR 검토 준비'}</p><h2>{inceptionOnly ? 'Plan을 함께 검토할 사람' : '함께 검토할 사람'}</h2>
    <div className="review-config-summary">{availableGates.map((gate) => { const item = detail.reviewConfigurations.find((configuration) => configuration.gate === gate); return <div key={gate}><strong>{gateLabel(gate, inceptionOnly)}</strong><span>{item?.policy === undefined ? (inceptionOnly ? '검토 기준 없음' : '정책 없음') : `${inceptionOnly ? '검토 기준' : '정책'} v${item.policy.policyRef.version}`}</span><span>{item?.validity === 'valid' ? '현재 통과' : item?.needsNewBundle ? '새 검토 필요' : '미통과'}</span></div>; })}</div>
    {!canAssign && <p className="quiet">{inceptionOnly ? '현재 Plan을 등록한 사람, 담당자 또는 팀 관리자가 검토자를 정할 수 있습니다.' : '현재 SR 등록자, 담당자 또는 팀 관리자가 검토자를 정할 수 있습니다.'}</p>}
    {(canAssign || canApplyPolicy) && <div className="assignment-layout">
      {canAssign && availableGates.map((gate) => { const configuration = detail.reviewConfigurations.find((item) => item.gate === gate); if (configuration === undefined) return null; return <GateAssignment key={gate} actorId={actorId} projectId={projectId} srId={detail.sr.scope.srId} gate={gate} configuration={configuration} preparation={detail.reviewPreparations.find((item) => item.gate === gate)} members={members} inceptionOnly={inceptionOnly} onSaved={onSaved} />; })}
      {canApplyPolicy && <PolicyApplicationForm actorId={actorId} projectId={projectId} srId={detail.sr.scope.srId} configurations={detail.reviewConfigurations} policies={policies} availableGates={availableGates} inceptionOnly={inceptionOnly} onSaved={onSaved} />}
    </div>}
  </section>;
}
