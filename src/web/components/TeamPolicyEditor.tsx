import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewPolicyVersionRef } from '@/src/contracts/context';
import type { PolicyEdit, PolicyView, WorkspaceView } from '@/src/contracts/views';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';

interface PolicyDraft {
  readonly mode: 'new' | 'revision';
  readonly description: string;
  readonly g1Roles: string;
  readonly g1Checklist: string;
  readonly g2Roles: string;
  readonly g2Checklist: string;
  readonly changeReason: string;
}

interface PolicyBasis {
  readonly revision: number;
  readonly policyKey: string;
  readonly policyRef?: ReviewPolicyVersionRef;
}

function checklistText(policy: PolicyView | undefined, gate: 'G1' | 'G2'): string {
  return policy?.gates[gate].checklist.map((item) => `${item.itemId} | ${item.label}`).join('\n') ?? '';
}

function policyDraft(workspace: WorkspaceView): PolicyDraft {
  const current = workspace.defaultPolicyRef === undefined ? undefined : workspace.policies.find((policy) =>
    policy.policyRef.entityId === workspace.defaultPolicyRef?.entityId &&
    policy.policyRef.version === workspace.defaultPolicyRef.version);
  return {
    mode: current === undefined ? 'new' : 'revision',
    description: current?.description ?? '',
    g1Roles: current?.gates.G1.requiredRoles.join('\n') ?? '',
    g1Checklist: checklistText(current, 'G1'),
    g2Roles: current?.gates.G2.requiredRoles.join('\n') ?? '',
    g2Checklist: checklistText(current, 'G2'),
    changeReason: '',
  };
}

function policyBasis(workspace: WorkspaceView): PolicyBasis {
  const ref = workspace.defaultPolicyRef;
  return {
    revision: workspace.revision,
    policyKey: ref === undefined ? 'absent' : `${ref.entityId}:${ref.version}`,
    ...(ref === undefined ? {} : { policyRef: ref }),
  };
}

function lines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function checklist(value: string): readonly [{ readonly itemId: string; readonly label: string }, ...{ readonly itemId: string; readonly label: string }[]] | undefined {
  const parsed = lines(value).map((line) => {
    const separator = line.indexOf('|');
    return separator < 1 ? undefined : { itemId: line.slice(0, separator).trim(), label: line.slice(separator + 1).trim() };
  });
  if (parsed.length === 0 || parsed.some((item) => item === undefined || item.label.length === 0)) return undefined;
  if (new Set(parsed.map((item) => item!.itemId)).size !== parsed.length) return undefined;
  return parsed as unknown as readonly [{ readonly itemId: string; readonly label: string }, ...{ readonly itemId: string; readonly label: string }[]];
}

function inputFor(basis: PolicyBasis, draft: PolicyDraft): PolicyEdit | undefined {
  const g1Roles = lines(draft.g1Roles);
  const g2Roles = lines(draft.g2Roles);
  const g1Checklist = checklist(draft.g1Checklist);
  const g2Checklist = checklist(draft.g2Checklist);
  if (g1Roles.length === 0 || g2Roles.length === 0 || g1Checklist === undefined || g2Checklist === undefined) return undefined;
  const common = {
    ...(draft.description.trim() === '' ? {} : { description: draft.description }),
    gates: {
      G1: { requiredRoles: g1Roles as [string, ...string[]], checklist: g1Checklist },
      G2: { requiredRoles: g2Roles as [string, ...string[]], checklist: g2Checklist },
    },
    requireAllAssigned: true as const,
    requireDistinctPeer: true as const,
  };
  if (draft.mode === 'new') return common;
  return basis.policyRef === undefined || draft.changeReason.trim() === '' ? undefined : {
    ...common, previousPolicyRef: basis.policyRef, changeReason: draft.changeReason,
  };
}

function localError(error: unknown) {
  return { code: 'STORE_UNAVAILABLE' as const, message: error instanceof Error ? error.message : '정책을 저장하지 못했습니다.', blockers: [], assigneeIds: [], targetRefs: [] };
}

export function TeamPolicyEditor({ actorId, workspace, onSaved }: {
  readonly actorId: string;
  readonly workspace: WorkspaceView;
  onSaved(): void;
}) {
  const projectId = workspace.project.projectId;
  const canEdit = workspace.actors.find((actor) => actor.actorId === actorId)?.roles.includes('team_admin') === true;
  const draft = useMemo(() => new FormDraft(
    { actorId, scope: { kind: 'project', projectId }, target: 'default-policy', form: 'team-policy' },
    policyDraft(workspace), policyBasis(workspace),
  ), [actorId, projectId]);
  const session = useMemo(() => new CommandSession(), [actorId, projectId]);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    draft.refreshFromServer(policyDraft(workspace), policyBasis(workspace));
    setSnapshot(draft.snapshot());
  }, [draft, workspace]);

  const edit = (patch: Partial<PolicyDraft>) => {
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
  };

  const execute = async (attempt: CommandAttempt<PolicyEdit, undefined>) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-029', { actorId, projectId, idempotencyKey: attempt.idempotencyKey }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId, scope: { kind: 'project', projectId }, target: 'default-policy', command: 'M-029',
      });
      if (!resolution.appliesToCurrentForm) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      const currentSnapshot = draft.snapshot();
      const currentInput = inputFor(currentSnapshot.basis, currentSnapshot.input);
      const changedWhileSaving = currentInput === undefined || JSON.stringify(currentInput) !== JSON.stringify(attempt.submission.input);
      if (!changedWhileSaving) {
        const next: PolicyDraft = { ...draft.snapshot().input, mode: 'revision', changeReason: '' };
        draft.markSaved(next, {
          revision: resolution.result.value.policyRef.version,
          policyKey: `${resolution.result.value.policyRef.entityId}:${resolution.result.value.policyRef.version}`,
          policyRef: resolution.result.value.policyRef,
        });
        setSnapshot(draft.snapshot());
      }
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 정책 버전을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: changedWhileSaving ? '이전 편집의 정책 버전을 저장했습니다. 현재 입력은 유지했습니다.' : '새 기본 정책 버전을 저장했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else setFeedback({ kind: 'rejected', error: localError(error) });
    } finally { session.endExecution(attempt); }
  };

  const submit = () => {
    const current = draft.snapshot();
    const input = inputFor(current.basis, current.input);
    if (input === undefined) {
      setFeedback({ kind: 'rejected', error: { code: 'VALIDATION_ERROR', message: '역할과 체크리스트를 채우고, 개정이면 변경 이유를 입력해 주세요.', blockers: [], assigneeIds: [], targetRefs: [] } });
      return;
    }
    void execute(session.submit({ actorId, scope: { kind: 'project', projectId }, target: 'default-policy', command: 'M-029', input, guard: undefined }));
  };

  return (
    <section className="form-panel policy-editor" aria-label="팀 검토 정책">
      <p className="eyebrow">프로젝트 기본 정책</p><h2>팀 검토 정책</h2>
      <p>승인하려면 지정된 검토자 전원 승인이 필요합니다. 또한 담당자 외 동료 승인이 필요합니다.</p>
      <p className="quiet">새 기본 정책은 이후 배정에 사용됩니다. 기존 SR에는 자동 적용되지 않습니다.</p>
      {!canEdit ? <p className="quiet">팀 관리자만 정책 버전을 저장할 수 있습니다.</p> : <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>정책 저장 방식<select value={snapshot.input.mode} onChange={(event) => edit({ mode: event.target.value as PolicyDraft['mode'] })}>{workspace.defaultPolicyRef === undefined ? <option value="new">첫 기본 정책 만들기</option> : <option value="revision">현재 정책 개정</option>}</select></label>
        <label>정책 설명<textarea value={snapshot.input.description} onChange={(event) => edit({ description: event.target.value })} /></label>
        <div className="policy-gates">
          <fieldset><legend>G1 기준</legend><label>G1 필수 역할<textarea value={snapshot.input.g1Roles} onChange={(event) => edit({ g1Roles: event.target.value })} /></label><label>G1 체크리스트<textarea value={snapshot.input.g1Checklist} onChange={(event) => edit({ g1Checklist: event.target.value })} /><small>한 줄에 `항목 ID | 확인 내용`을 입력합니다.</small></label></fieldset>
          <fieldset><legend>G2 기준</legend><label>G2 필수 역할<textarea value={snapshot.input.g2Roles} onChange={(event) => edit({ g2Roles: event.target.value })} /></label><label>G2 체크리스트<textarea value={snapshot.input.g2Checklist} onChange={(event) => edit({ g2Checklist: event.target.value })} /></label></fieldset>
        </div>
        {snapshot.input.mode === 'revision' && <label>정책 변경 이유<textarea value={snapshot.input.changeReason} onChange={(event) => edit({ changeReason: event.target.value })} /></label>}
        {snapshot.dirty && <span className="dirty-indicator">저장하지 않은 정책 편집이 있습니다.</span>}
        {snapshot.latestServer !== undefined && <div className="draft-comparison"><p>서버의 최신 정책이 바뀌었습니다.</p><div className="draft-actions"><button type="button" onClick={() => { if (draft.adoptLatestBasis(snapshot.identity)) setSnapshot(draft.snapshot()); }}>현재 입력에 최신 기준 사용</button><button type="button" onClick={() => { if (draft.discardToLatest(snapshot.identity)) setSnapshot(draft.snapshot()); }}>내 편집 폐기</button></div></div>}
        <button className="primary-button" type="submit">정책 버전 저장</button>
      </form>}
      <CommandFeedback state={feedback} />
    </section>
  );
}
