import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtifactView, ContextSourceView, ImportOutcome, NewSR, ReviewerAssignment, SRView } from '@/src/contracts/views';
import { invoke, TransportUncertainError } from '../api/client';
import { FormDraft } from '../state/form-draft';
import { deriveDraftDocumentStructure, suggestPurpose, suggestSrKey } from '../state/draft-document';
import '../styles/draft-onboarding.css';

interface RegistrationInput extends NewSR {
  readonly ticketKey: string;
  readonly draftMarkdown: string;
  readonly provenance: string;
  readonly reviewerIds: readonly string[];
}

interface OnboardingCheckpoint {
  readonly input: RegistrationInput;
  readonly sr?: SRView;
  readonly source?: ContextSourceView;
  readonly artifact?: ArtifactView;
}

const blank = (ownerId: string): RegistrationInput => ({
  key: '', title: '', purpose: '', description: '', ownerId, ticketKey: '',
  existingSystem: false, draftMarkdown: '', provenance: '사용자가 등록할 때 제공한 초안', reviewerIds: [],
});

const MAX_DRAFT_BYTES = 1024 * 1024;

function stageMessage(checkpoint: OnboardingCheckpoint | undefined): string {
  if (checkpoint?.artifact !== undefined) return '업무와 문서를 저장했습니다. 검토자 지정부터 다시 진행합니다.';
  if (checkpoint?.source !== undefined) return '업무와 원문을 저장했습니다. 문서 저장부터 다시 진행합니다.';
  if (checkpoint?.sr !== undefined) return '업무를 등록했습니다. 원문 저장부터 다시 진행합니다.';
  return '업무 등록부터 진행합니다.';
}

export function SRRegistrationForm({ actorId, projectId, owners, onCancel, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly owners: readonly { readonly actorId: string; readonly displayName: string }[];
  onCancel(): void;
  onSaved(srId: string): void;
}) {
  const initialOwner = owners.some((owner) => owner.actorId === actorId) ? actorId : owners[0]?.actorId ?? actorId;
  const identity = { actorId, scope: { kind: 'project' as const, projectId }, target: 'new-sr', form: 'sr-registration' };
  const draft = useMemo(() => new FormDraft(identity, blank(initialOwner), { revision: 0 }), [actorId, projectId, initialOwner]);
  const requestIds = useRef({ register: crypto.randomUUID(), source: crypto.randomUUID(), artifact: crypto.randomUUID(), assignment: crypto.randomUUID(), import: crypto.randomUUID() });
  const keyEdited = useRef(false);
  const descriptionEdited = useRef(false);
  const mounted = useRef(true);
  const executing = useRef(false);
  const assignmentAttempt = useRef<{ readonly input: ReviewerAssignment; readonly expectedRevision: number } | undefined>(undefined);
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [checkpoint, setCheckpoint] = useState<OnboardingCheckpoint>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const edit = (patch: Partial<RegistrationInput>) => {
    if (checkpoint !== undefined) return;
    draft.edit({ ...draft.snapshot().input, ...patch });
    setSnapshot(draft.snapshot());
    setError(undefined);
  };
  const editTitle = (title: string) => {
    const current = draft.snapshot().input;
    edit({
      title,
      ...(keyEdited.current ? {} : { key: suggestSrKey(title) }),
      ...(current.purpose === '' || current.purpose === suggestPurpose(current.title) ? { purpose: suggestPurpose(title) } : {}),
      ...(descriptionEdited.current ? {} : { description: current.draftMarkdown || title }),
    });
  };
  const editMarkdown = (draftMarkdown: string) => {
    edit({ draftMarkdown, ...(descriptionEdited.current ? {} : { description: draftMarkdown }) });
  };
  const loadDraftFile = async (file: File | undefined) => {
    if (file === undefined || checkpoint !== undefined) return;
    try {
      const markdown = await file.text();
      if (new TextEncoder().encode(markdown).byteLength > MAX_DRAFT_BYTES) {
        setError('초안 파일은 UTF-8 기준 1 MiB 이하만 등록할 수 있습니다. 파일을 나누거나 내용을 줄여 주세요.');
        return;
      }
      editMarkdown(markdown);
      edit({ provenance: `사용자가 등록할 때 제공한 파일: ${file.name}` });
    } catch {
      setError('초안 파일을 읽지 못했습니다. 내용을 직접 붙여 넣어 주세요.');
    }
  };

  const continueDirect = async () => {
    if (executing.current) return;
    executing.current = true;
    const frozen = checkpoint?.input ?? draft.snapshot().input;
    let sr = checkpoint?.sr;
    let source = checkpoint?.source;
    let artifact = checkpoint?.artifact;
    setPending(true); setError(undefined); setUncertain(false);
    try {
      if (frozen.title.trim() === '' || frozen.key.trim() === '') {
        setError('업무를 구분할 수 있도록 제목을 입력해 주세요.');
        return;
      }
      const document = frozen.draftMarkdown.trim() === ''
        ? undefined
        : { markdown: frozen.draftMarkdown, ...deriveDraftDocumentStructure(frozen.draftMarkdown) };
      if (new TextEncoder().encode(frozen.draftMarkdown).byteLength > MAX_DRAFT_BYTES
        || (document !== undefined && new TextEncoder().encode(document.markdown).byteLength > MAX_DRAFT_BYTES)) {
        setError('초안은 UTF-8 기준 1 MiB 이하만 등록할 수 있습니다. 내용을 나누거나 줄여 주세요.');
        return;
      }
      if (sr === undefined) {
        const input: NewSR = {
          key: frozen.key, title: frozen.title, purpose: frozen.purpose || suggestPurpose(frozen.title),
          description: frozen.description || frozen.draftMarkdown, ownerId: frozen.ownerId,
          existingSystem: frozen.existingSystem ?? false,
        };
        const result = await invoke('M-003', { actorId, projectId, requestId: requestIds.current.register, idempotencyKey: requestIds.current.register }, input);
        if (!mounted.current) return;
        if (!result.ok) { setError(result.error.message); return; }
        sr = result.value;
        setCheckpoint({ input: frozen, sr });
      }
      if (document !== undefined && frozen.ownerId === actorId) {
        if (source === undefined) {
          const result = await invoke('M-006', {
            actorId, projectId, srId: sr.scope.srId, requestId: requestIds.current.source, idempotencyKey: requestIds.current.source,
            guard: { resource: { target: { kind: 'sr', projectId, srId: sr.scope.srId, entityId: sr.scope.srId }, expectedRevision: sr.revision } },
          }, { kind: 'markdown', content: frozen.draftMarkdown, provenance: frozen.provenance, displayName: `${frozen.title} 시작 초안` });
          if (!mounted.current) return;
          if (!result.ok) { setError(result.error.message); return; }
          source = result.value;
          setCheckpoint({ input: frozen, sr, source });
        }
        if (artifact === undefined) {
          const result = await invoke('M-015', {
            actorId, projectId, srId: sr.scope.srId, requestId: requestIds.current.artifact, idempotencyKey: requestIds.current.artifact,
            guard: { resource: { target: { kind: 'artifact_logical_key', projectId, srId: sr.scope.srId, logicalKey: 'requirements' }, expected: 'absent' } },
          }, {
            kind: 'requirements', markdown: document.markdown, sectionIndex: document.sectionIndex,
            requirementLinks: document.requirementLinks, changeSummary: '등록한 초안을 Plan 문서로 저장합니다.',
            targetBasis: { kind: 'absent', logicalKey: 'requirements' }, sourceRefs: [source.currentVersionRef],
          });
          if (!mounted.current) return;
          if (!result.ok) { setError(result.error.message); return; }
          artifact = result.value;
          setCheckpoint({ input: frozen, sr, source, artifact });
        }
      }
      if (frozen.reviewerIds.length > 0) {
        if (assignmentAttempt.current === undefined) {
          const detail = await invoke('M-047', { actorId, projectId, srId: sr.scope.srId }, {});
          if (!mounted.current) return;
          if (!detail.ok) { setError(detail.error.message); return; }
          const configuration = detail.value.reviewConfigurations.find((item) => item.gate === 'G1');
          if (configuration === undefined) { setError('Plan 검토 준비 상태를 읽지 못했습니다. 상세 화면에서 검토자를 지정해 주세요.'); return; }
          const assignment = configuration.assignment;
          assignmentAttempt.current = {
            expectedRevision: configuration.revision,
            input: assignment === undefined
              ? { gate: 'G1', reviewerIds: frozen.reviewerIds }
              : { gate: 'G1', reviewerIds: frozen.reviewerIds, previousAssignmentRef: assignment.assignmentRef, changeReason: '등록자가 첫 Plan 검토자를 지정합니다.' },
          };
        }
        const attempt = assignmentAttempt.current;
        const result = await invoke('M-030', {
          actorId, projectId, srId: sr.scope.srId,
          requestId: requestIds.current.assignment, idempotencyKey: requestIds.current.assignment,
          guard: { resource: { target: { kind: 'review_gate_state', projectId, srId: sr.scope.srId, entityId: 'G1' }, expectedRevision: attempt.expectedRevision } },
        }, attempt.input);
        if (!mounted.current) return;
        if (!result.ok) {
          assignmentAttempt.current = undefined;
          requestIds.current.assignment = crypto.randomUUID();
          setError(result.error.message); return;
        }
      }
      onSaved(sr.scope.srId);
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof TransportUncertainError) {
        setUncertain(true);
        setError('저장 결과를 확인하지 못했습니다. 같은 요청으로 완료되지 않은 단계부터 다시 확인할 수 있습니다.');
      } else setError(caught instanceof Error ? caught.message : '초안 등록을 완료하지 못했습니다.');
    } finally {
      executing.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const importMock = async () => {
    if (executing.current) return;
    executing.current = true;
    const input = draft.snapshot().input;
    setPending(true); setError(undefined);
    try {
      const result = await invoke('M-004', { actorId, projectId, requestId: requestIds.current.import, idempotencyKey: requestIds.current.import }, input.ticketKey);
      if (!mounted.current) return;
      if (!result.ok) { setError(result.error.message); return; }
      const value: ImportOutcome = result.value;
      onSaved(value.sr.scope.srId);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : 'Mock 요청을 가져오지 못했습니다.');
    } finally {
      executing.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return <section className="form-panel draft-first-form" aria-labelledby="registration-title">
    <div className="section-heading"><div><p className="eyebrow">초안으로 시작</p><h2 id="registration-title">SR 작성</h2></div>
      <button type="button" className="text-button" onClick={() => checkpoint?.sr === undefined ? onCancel() : onSaved(checkpoint.sr.scope.srId)}>{checkpoint?.sr === undefined ? '닫기' : '등록된 SR 열기'}</button></div>
    <p>원하는 일을 적어 주세요. 가지고 있는 문서를 바로 등록하고, 필요할 때 AI의 도움을 받을 수 있습니다.</p>
    <form onSubmit={(event) => { event.preventDefault(); void continueDirect(); }}>
      <div className="draft-primary">
        <label>제목<input required data-testid="sr-registration-form-title-input" value={snapshot.input.title} disabled={checkpoint !== undefined} onChange={(event) => editTitle(event.target.value)} placeholder="예: 결제 취소 기능 개선" /></label>
        <label>가지고 있는 문서<textarea rows={14} value={snapshot.input.draftMarkdown} disabled={checkpoint !== undefined} onChange={(event) => editMarkdown(event.target.value)} placeholder={'결제 취소 요청을 받은 뒤 환불 상태를 확인할 수 있어야 합니다.\n\n완료 기준: 사용자가 처리 결과를 바로 확인할 수 있습니다.'} /><small>등록한 원문을 그대로 Plan 문서로 보관합니다. AI 정리는 선택 사항입니다.</small></label>
        <label>Markdown 파일 선택<input type="file" accept=".md,.markdown,text/markdown,text/plain" disabled={checkpoint !== undefined} onChange={(event) => { void loadDraftFile(event.target.files?.[0]); }} /><small>파일 내용은 바꾸지 않고 위 초안에 불러옵니다.</small></label>
        <label>담당자<select value={snapshot.input.ownerId} disabled={checkpoint !== undefined} onChange={(event) => edit({ ownerId: event.target.value, reviewerIds: snapshot.input.reviewerIds.filter((id) => id !== event.target.value) })}>{owners.map((owner) => <option key={owner.actorId} value={owner.actorId}>{owner.displayName}</option>)}</select><small>다른 담당자를 지정하면 초안은 원 설명에 보존되고, 담당자가 상세 화면에서 문서로 정리합니다.</small></label>
        <fieldset><legend>Plan 검토자</legend><p className="quiet">지금 선택하거나 상세 화면에서 나중에 정할 수 있습니다.</p>{owners.filter((owner) => owner.actorId !== snapshot.input.ownerId).map((owner) => <label className="checkbox-label" key={owner.actorId}><input type="checkbox" checked={snapshot.input.reviewerIds.includes(owner.actorId)} disabled={checkpoint !== undefined} onChange={(event) => edit({ reviewerIds: event.target.checked ? [...snapshot.input.reviewerIds, owner.actorId] : snapshot.input.reviewerIds.filter((id) => id !== owner.actorId) })} />{owner.displayName}</label>)}</fieldset>
      </div>
      <details className="advanced-fields"><summary>세부 등록 정보</summary><div>
        <label>SR 키<input value={snapshot.input.key} disabled={checkpoint !== undefined} onChange={(event) => { keyEdited.current = true; edit({ key: event.target.value }); }} /><small>제목에서 자동 제안합니다. 중복이면 바꿔 주세요.</small></label>
        <label>목적<textarea value={snapshot.input.purpose} disabled={checkpoint !== undefined} onChange={(event) => edit({ purpose: event.target.value })} /></label>
        <label>설명<textarea rows={5} value={snapshot.input.description} disabled={checkpoint !== undefined} onChange={(event) => { descriptionEdited.current = true; edit({ description: event.target.value }); }} /></label>
        <label>초안 출처<input value={snapshot.input.provenance} disabled={checkpoint !== undefined} onChange={(event) => edit({ provenance: event.target.value })} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={snapshot.input.existingSystem === true} disabled={checkpoint !== undefined} onChange={(event) => edit({ existingSystem: event.target.checked })} />기존 시스템 변경</label>
      </div></details>
      {checkpoint !== undefined && <div className="onboarding-progress" role="status"><strong>저장 진행 상황</strong><ol><li>업무 등록 완료</li><li>{checkpoint.source === undefined ? '원문 저장 대기' : '원문 저장 완료'}</li><li>{checkpoint.artifact === undefined ? 'Plan 문서 저장 대기' : 'Plan 문서 저장 완료'}</li><li>{snapshot.input.reviewerIds.length === 0 ? '검토자는 나중에 지정' : '검토자 지정 대기'}</li></ol><p>{stageMessage(checkpoint)}</p></div>}
      {error !== undefined && <div className="command-feedback error" role="alert"><strong>{error}</strong></div>}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? '등록 중…' : uncertain ? '같은 요청 확인' : checkpoint !== undefined ? '완료되지 않은 단계 다시 시도' : 'SR 등록하고 Plan 시작'}</button>
    </form>
    <details className="advanced-fields"><summary>Mock 키 가져오기</summary><div><label>Mock 티켓 키<input value={snapshot.input.ticketKey} disabled={checkpoint !== undefined} onChange={(event) => edit({ ticketKey: event.target.value })} placeholder="PAY-102" /></label><button type="button" disabled={pending || snapshot.input.ticketKey.trim() === ''} onClick={() => { void importMock(); }}>가져오기</button></div></details>
    {snapshot.dirty && checkpoint === undefined && <p className="dirty-indicator">저장하지 않은 입력이 있습니다.</p>}
  </section>;
}
