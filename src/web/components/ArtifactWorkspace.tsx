import { useEffect, useRef, useState } from 'react';
import type {
  ArtifactEdit,
  ArtifactView,
  DecisionView,
  QuestionView,
  ContextSourceView,
} from '@/src/contracts/views';
import type {
  ContextSourceVersionRef,
  DecisionVersionRef,
  QuestionResultSnapshotRef,
  RevisionOrAbsentGuard,
} from '@/src/contracts/context';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft, type FormDraftIdentity } from '../state/form-draft';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { VersionComparison } from './VersionComparison';
import { deriveArtifactSectionIndex } from '@/src/domain/artifact-rules';
import { artifactLogicalTarget, parseArtifactLogicalKey } from '@/src/domain/artifact-target';
import { deriveDraftDocumentStructure } from '../state/draft-document';
import '../styles/draft-onboarding.css';

export interface ArtifactTargetOption {
  readonly logicalKey: 'requirements' | 'workflow_plan' | 'implementation_plan' |
    'design:application' | 'design:functional' | 'design:nfr' | 'design:infrastructure';
  readonly label: string;
  readonly editable: boolean;
}

interface SectionDraft {
  readonly sectionId: string;
}

interface RequirementDraft {
  readonly requirementId: string;
  readonly sectionIds: string;
  readonly acceptanceCriteria: string;
}

interface ArtifactFormInput {
  readonly markdown: string;
  readonly sections: readonly SectionDraft[];
  readonly requirements: readonly RequirementDraft[];
  readonly changeSummary: string;
  readonly decisionRefs: readonly DecisionVersionRef[];
  readonly sourceRefs: readonly ContextSourceVersionRef[];
  readonly questionResultRefs: readonly QuestionResultSnapshotRef[];
}

interface ArtifactFormBasis {
  readonly artifact?: ArtifactView;
  readonly logicalKey: ArtifactTargetOption['logicalKey'];
}

type ArtifactAttempt = CommandAttempt<ArtifactEdit, RevisionOrAbsentGuard<'artifact'>>;

function matchesTarget(artifact: ArtifactView, logicalKey: string): boolean {
  return artifactLogicalTarget(artifact.kind, artifact.designStage).logicalKey === logicalKey;
}

function emptyInput(): ArtifactFormInput {
  return {
    markdown: '',
    sections: [{ sectionId: '' }],
    requirements: [{ requirementId: '', sectionIds: '', acceptanceCriteria: '' }],
    changeSummary: '',
    decisionRefs: [],
    sourceRefs: [],
    questionResultRefs: [],
  };
}

function withDerivedStructure(input: ArtifactFormInput, markdown: string): ArtifactFormInput {
  const structure = deriveDraftDocumentStructure(markdown);
  return {
    ...input,
    markdown,
    sections: structure.sectionIndex.map((section) => ({ sectionId: section.sectionId })),
    requirements: structure.requirementLinks.map((requirement) => ({
      requirementId: requirement.requirementId,
      sectionIds: requirement.sectionIds.join(', '),
      acceptanceCriteria: requirement.acceptanceCriteria.join('\n'),
    })),
  };
}

function inputFromArtifact(artifact: ArtifactView | undefined): ArtifactFormInput {
  if (artifact === undefined) return emptyInput();
  return {
    markdown: artifact.markdown,
    sections: artifact.sectionIndex.map((section) => ({ sectionId: section.sectionId })),
    requirements: artifact.requirementLinks.map((link) => ({
      requirementId: link.requirementId,
      sectionIds: link.sectionIds.join(', '),
      acceptanceCriteria: link.acceptanceCriteria.join('\n'),
    })),
    changeSummary: '',
    decisionRefs: artifact.decisionRefs,
    sourceRefs: artifact.sourceRefs,
    questionResultRefs: artifact.questionResultRefs,
  };
}

function sameInput(left: ArtifactEdit, right: ArtifactEdit): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function refKey(ref: { readonly kind: string; readonly entityId: string; readonly version: number }): string {
  return `${ref.kind}:${ref.entityId}:${ref.version}`;
}

function uniqueRefs<T extends { readonly kind: string; readonly entityId: string; readonly version: number }>(
  refs: readonly T[],
): readonly T[] {
  return [...new Map(refs.map((ref) => [refKey(ref), ref])).values()];
}

function parseIds(value: string): readonly string[] {
  return value.split(/[,\n]/u).map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseLines(value: string): readonly string[] {
  return value.split(/\r?\n/u).filter((item) => item.trim().length > 0);
}

function buildEdit(target: ArtifactTargetOption, basis: ArtifactFormBasis, input: ArtifactFormInput): ArtifactEdit {
  const logicalTarget = parseArtifactLogicalKey(target.logicalKey);
  const common = {
    ...(basis.artifact === undefined ? {} : { artifactId: basis.artifact.artifactId }),
    markdown: input.markdown,
    sectionIndex: deriveArtifactSectionIndex(
      input.markdown,
      input.sections.map((section) => section.sectionId.trim()),
    ),
    requirementLinks: input.requirements.map((requirement) => ({
      requirementId: requirement.requirementId.trim(),
      sectionIds: parseIds(requirement.sectionIds) as [string, ...string[]],
      acceptanceCriteria: parseLines(requirement.acceptanceCriteria),
    })),
    changeSummary: input.changeSummary,
    targetBasis: basis.artifact === undefined
      ? { kind: 'absent' as const, logicalKey: target.logicalKey }
      : { kind: 'version' as const, ref: basis.artifact.versionRef },
    decisionRefs: input.decisionRefs,
    sourceRefs: input.sourceRefs,
    questionResultRefs: input.questionResultRefs,
  };
  if (logicalTarget.kind === 'design') {
    return {
      ...common,
      kind: 'design',
      designStage: logicalTarget.designStage!,
    };
  }
  if (logicalTarget.kind === 'workflow_plan') {
    throw new Error('진행 계획은 전용 편집 화면에서 저장합니다.');
  }
  return { ...common, kind: logicalTarget.kind };
}

function artifactIdentity(actorId: string, projectId: string, srId: string, logicalKey: string): FormDraftIdentity {
  return {
    actorId,
    scope: { kind: 'sr', projectId, srId },
    target: logicalKey,
    form: 'artifact-edit',
  };
}

function ArtifactEditor({ actorId, projectId, srId, ownerId, target, artifact, decisions, sources, questions, onSaved, onRefresh }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly srId: string;
  readonly ownerId: string;
  readonly target: ArtifactTargetOption;
  readonly artifact?: ArtifactView;
  readonly decisions: readonly DecisionView[];
  readonly sources: readonly ContextSourceView[];
  readonly questions: readonly QuestionView[];
  onSaved(): void;
  onRefresh(): void;
}) {
  const identity = artifactIdentity(actorId, projectId, srId, target.logicalKey);
  const initialBasis: ArtifactFormBasis = { logicalKey: target.logicalKey, ...(artifact === undefined ? {} : { artifact }) };
  const draftRef = useRef(new FormDraft(identity, inputFromArtifact(artifact), initialBasis));
  const sessionRef = useRef(new CommandSession());
  const serverIdentityRef = useRef(artifact === undefined ? 'absent' : `${artifact.artifactId}:${artifact.revision}`);
  const [snapshot, setSnapshot] = useState(() => draftRef.current.snapshot());
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [unknownAttempt, setUnknownAttempt] = useState<ArtifactAttempt>();
  const [lastSavedResult, setLastSavedResult] = useState<ArtifactView>();

  const sync = () => setSnapshot(draftRef.current.snapshot());
  const nextServerIdentity = artifact === undefined ? 'absent' : `${artifact.artifactId}:${artifact.revision}`;
  useEffect(() => {
    if (serverIdentityRef.current === nextServerIdentity) return;
    serverIdentityRef.current = nextServerIdentity;
    setLastSavedResult(undefined);
    draftRef.current.refreshFromServer(inputFromArtifact(artifact), {
      logicalKey: target.logicalKey,
      ...(artifact === undefined ? {} : { artifact }),
    });
    sync();
  }, [artifact, nextServerIdentity, target.logicalKey]);

  const edit = (next: ArtifactFormInput) => {
    draftRef.current.edit(next);
    draftRef.current.setFieldErrors({});
    sync();
    setFeedback(undefined);
    setError(undefined);
  };
  const patch = (value: Partial<ArtifactFormInput>) => edit({ ...draftRef.current.snapshot().input, ...value });

  const execute = async (attempt: ArtifactAttempt) => {
    if (!sessionRef.current.beginExecution(attempt)) return;
    setPending(true);
    setError(undefined);
    try {
      const result = asCommandResult(await invoke('M-015', {
        actorId,
        projectId,
        srId,
        idempotencyKey: attempt.idempotencyKey,
        guard: attempt.submission.guard,
      }, attempt.submission.input));
      const resolution = sessionRef.current.resolve(attempt, result, {
        actorId, scope: { kind: 'sr', projectId, srId }, target: target.logicalKey, command: 'M-015',
      });
      if (!resolution.appliesToCurrentForm) return;
      if (resolution.result.kind === 'rejected') {
        setError(resolution.result.error.message);
        return;
      }
      setUnknownAttempt(undefined);
      const saved = resolution.result.value;
      setLastSavedResult(saved);
      serverIdentityRef.current = `${saved.artifactId}:${saved.revision}`;
      const savedBasis: ArtifactFormBasis = { logicalKey: target.logicalKey, artifact: saved };
      let liveMatchesAttempt = false;
      try {
        const liveEdit = buildEdit(target, draftRef.current.snapshot().basis, draftRef.current.snapshot().input);
        liveMatchesAttempt = sameInput(liveEdit, attempt.submission.input);
      } catch {
        liveMatchesAttempt = false;
      }
      if (!liveMatchesAttempt) {
        draftRef.current.refreshFromServer(inputFromArtifact(saved), savedBasis);
        sync();
        setFeedback('이전 문서의 저장 결과를 확인했습니다. 현재 편집은 유지했습니다.');
        onSaved();
        return;
      }
      draftRef.current.markSaved(inputFromArtifact(saved), savedBasis);
      sync();
      setFeedback('문서를 저장했습니다.');
      onSaved();
    } catch (caught) {
      if (caught instanceof TransportUncertainError) {
        sessionRef.current.markResultUnknown(attempt);
        setUnknownAttempt(attempt);
        setError('저장 결과를 확인할 수 없습니다. 같은 요청으로 결과를 다시 확인하세요.');
      } else {
        sessionRef.current.endExecution(attempt);
        setError(caught instanceof Error ? caught.message : '문서를 저장하지 못했습니다.');
      }
    } finally {
      setPending(false);
    }
  };

  const submit = () => {
    const current = draftRef.current.snapshot();
    if (current.input.changeSummary.trim().length === 0) {
      draftRef.current.setFieldErrors({ changeSummary: '변경 이유를 입력하세요.' });
      sync();
      return;
    }
    let input: ArtifactEdit;
    try {
      input = buildEdit(target, current.basis, current.input);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '문서 구조를 원문에서 계산하지 못했습니다.');
      return;
    }
    const guard = current.basis.artifact === undefined
      ? { resource: { target: {
          kind: 'artifact_logical_key' as const, projectId, srId, logicalKey: target.logicalKey,
        }, expected: 'absent' as const } }
      : { resource: { target: {
          kind: 'artifact' as const, projectId, srId, entityId: current.basis.artifact.artifactId,
        }, expectedRevision: current.basis.artifact.revision } };
    const attempt = sessionRef.current.submit({
      actorId, scope: { kind: 'sr', projectId, srId }, target: target.logicalKey,
      command: 'M-015', input, guard,
    }) as ArtifactAttempt;
    void execute(attempt);
  };

  const current = snapshot.input;
  const canEdit = target.editable && actorId === ownerId;
  const decisionCandidates = uniqueRefs([
    ...current.decisionRefs,
    ...decisions.flatMap((decision) => decision.currentConfirmation?.ref === undefined ? [] : [decision.currentConfirmation.ref]),
  ]);
  const sourceCandidates = uniqueRefs([...current.sourceRefs, ...sources.map((source) => source.currentVersionRef)]);
  const questionCandidates = uniqueRefs([...current.questionResultRefs, ...questions.map((question) => question.currentResult.ref)]);
  const toggle = <T extends { readonly kind: string; readonly entityId: string; readonly version: number }>(
    refs: readonly T[], ref: T, checked: boolean,
  ) => checked ? uniqueRefs([...refs, ref]) : refs.filter((item) => refKey(item) !== refKey(ref));

  if (!target.editable) {
    return <section className="artifact-card" data-testid="artifact-workspace">
      <h3>{target.label}</h3>
      {artifact === undefined ? <p className="empty-state">진행 계획이 아직 없습니다. 현재 화면에서는 설계 문서를 선택해 작성할 수 있습니다.</p> : <>
        <p>문서 v{artifact.versionRef.version} · {artifact.authorOrigin === 'human' ? '사람 작성' : 'AI 초안 적용'}</p>
        <pre className="artifact-readonly">{artifact.markdown}</pre>
        <VersionComparison actorId={actorId} projectId={projectId} srId={srId} artifact={artifact} />
      </>}
    </section>;
  }

  return <section className="artifact-card" data-testid="artifact-workspace">
    <header className="artifact-heading">
      <div><p className="eyebrow">문서 편집</p><h3>{target.label}</h3></div>
      <div>{snapshot.basis.artifact === undefined ? <p>새 문서</p> : <>
        <p>문서 v{snapshot.basis.artifact.versionRef.version} · {snapshot.basis.artifact.authorOrigin === 'human' ? '사람 작성' : 'AI 초안 적용'} · {snapshot.basis.artifact.createdAt}</p>
      </>}</div>
    </header>
    {lastSavedResult !== undefined && <p className="command-feedback success">이번 저장 결과: 검토 영향 {lastSavedResult.reviewImpact.affectedGates.length === 0 ? '없음' : lastSavedResult.reviewImpact.affectedGates.join(', ')} · {lastSavedResult.reviewImpact.needsNewReview ? '재검토 필요' : '추가 재검토 없음'}</p>}
    {!canEdit && <p className="quiet">현재 SR 담당자만 문서를 저장할 수 있습니다. 원문과 구조는 읽을 수 있습니다.</p>}
    <div className="document-guidance"><strong>문서 내용을 먼저 작성하세요.</strong><p>제목과 요구사항 구분은 Markdown의 `##` 제목에서 자동으로 찾습니다. 저장 전에 아래 고급 설정에서 연결 결과를 확인할 수 있습니다.</p></div>
    <label>Markdown 원문<textarea rows={14} value={current.markdown} readOnly={!canEdit} onChange={(event) => edit(withDerivedStructure(draftRef.current.snapshot().input, event.target.value))} /></label>
    {canEdit && <button type="button" onClick={() => edit(withDerivedStructure(draftRef.current.snapshot().input, current.markdown))}>본문에서 구조 다시 찾기</button>}
    <p className="quiet">찾은 섹션 {current.sections.filter((item) => item.sectionId.trim() !== '').length}개 · 요구사항 {current.requirements.filter((item) => item.requirementId.trim() !== '').length}개</p>
    <details className="document-advanced"><summary>구조와 추적 연결 확인</summary>
    <section className="artifact-structure" aria-labelledby={`sections-${target.logicalKey}`}>
      <div className="artifact-subheading"><h4 id={`sections-${target.logicalKey}`}>문서 섹션</h4>{canEdit && <button type="button" onClick={() => patch({
        sections: [{ sectionId: '' }],
        requirements: [{ requirementId: '', sectionIds: '', acceptanceCriteria: '' }],
      })}>구조 초기화</button>}</div>
      {current.sections.map((section, index) => <fieldset key={index}>
        <legend>섹션 {index + 1}</legend>
        <label>섹션 ID<input aria-label="섹션 ID" value={section.sectionId} readOnly={!canEdit} onChange={(event) => patch({ sections: current.sections.map((item, itemIndex) => itemIndex === index ? { ...item, sectionId: event.target.value } : item) })} /></label>
        {canEdit && current.sections.length > 1 && <button type="button" onClick={() => patch({ sections: current.sections.filter((_, itemIndex) => itemIndex !== index) })}>섹션 {index + 1} 삭제</button>}
      </fieldset>)}
      {canEdit && <button type="button" onClick={() => patch({ sections: [...current.sections, { sectionId: '' }] })}>섹션 추가</button>}
    </section>
    <section className="artifact-structure" aria-labelledby={`requirements-${target.logicalKey}`}>
      <h4 id={`requirements-${target.logicalKey}`}>요구사항과 수용 기준</h4>
      {current.requirements.map((requirement, index) => <fieldset key={index}>
        <legend>요구사항 {index + 1}</legend>
        <label>요구사항 ID<input aria-label="요구사항 ID" value={requirement.requirementId} readOnly={!canEdit} onChange={(event) => patch({ requirements: current.requirements.map((item, itemIndex) => itemIndex === index ? { ...item, requirementId: event.target.value } : item) })} /></label>
        <label>연결 섹션 ID<input aria-label="연결 섹션 ID" value={requirement.sectionIds} readOnly={!canEdit} onChange={(event) => patch({ requirements: current.requirements.map((item, itemIndex) => itemIndex === index ? { ...item, sectionIds: event.target.value } : item) })} /><small>쉼표나 줄바꿈으로 구분합니다.</small></label>
        <label>수용 기준<textarea aria-label="수용 기준" rows={3} value={requirement.acceptanceCriteria} readOnly={!canEdit} onChange={(event) => patch({ requirements: current.requirements.map((item, itemIndex) => itemIndex === index ? { ...item, acceptanceCriteria: event.target.value } : item) })} /><small>한 줄에 하나씩 입력합니다.</small></label>
        {canEdit && current.requirements.length > 1 && <button type="button" onClick={() => patch({ requirements: current.requirements.filter((_, itemIndex) => itemIndex !== index) })}>요구사항 {index + 1} 삭제</button>}
      </fieldset>)}
      {canEdit && <button type="button" onClick={() => patch({ requirements: [...current.requirements, { requirementId: '', sectionIds: '', acceptanceCriteria: '' }] })}>요구사항 추가</button>}
    </section>
    <fieldset className="artifact-refs"><legend>추적 참조</legend>
      {decisionCandidates.map((ref) => <label key={refKey(ref)}><input type="checkbox" checked={current.decisionRefs.some((item) => refKey(item) === refKey(ref))} disabled={!canEdit} onChange={(event) => patch({ decisionRefs: toggle(current.decisionRefs, ref, event.target.checked) })} />결정 {ref.entityId} v{ref.version}</label>)}
      {sourceCandidates.map((ref) => <label key={refKey(ref)}><input type="checkbox" checked={current.sourceRefs.some((item) => refKey(item) === refKey(ref))} disabled={!canEdit} onChange={(event) => patch({ sourceRefs: toggle(current.sourceRefs, ref, event.target.checked) })} />근거 {ref.entityId} v{ref.version}</label>)}
      {questionCandidates.map((ref) => <label key={refKey(ref)}><input type="checkbox" checked={current.questionResultRefs.some((item) => refKey(item) === refKey(ref))} disabled={!canEdit} onChange={(event) => patch({ questionResultRefs: toggle(current.questionResultRefs, ref, event.target.checked) })} />질문 결과 {ref.entityId} v{ref.version}</label>)}
      {decisionCandidates.length + sourceCandidates.length + questionCandidates.length === 0 && <p className="quiet">연결할 현재 참조가 없습니다.</p>}
    </fieldset>
    </details>
    <label>문서 개정 사유<textarea rows={3} value={current.changeSummary} readOnly={!canEdit} onChange={(event) => patch({ changeSummary: event.target.value })} />{snapshot.fieldErrors.changeSummary !== undefined && <small className="field-error">{snapshot.fieldErrors.changeSummary}</small>}</label>
    {error !== undefined && <div role="alert" className="command-error"><p>{error}</p>{unknownAttempt !== undefined && <button type="button" onClick={() => { void execute(sessionRef.current.retry(unknownAttempt) as ArtifactAttempt); }}>같은 요청 결과 확인</button>}{unknownAttempt === undefined && <button type="button" onClick={onRefresh}>최신 상태 확인</button>}</div>}
    {feedback !== undefined && <p role="status">{feedback}</p>}
    {snapshot.latestServer !== undefined && <div className="basis-comparison" role="status">
      <strong>최신 문서 {snapshot.latestServer.basis.artifact === undefined ? '없음' : `v${snapshot.latestServer.basis.artifact.versionRef.version}`}</strong>
      <pre>{snapshot.latestServer.input.markdown}</pre>
      <button type="button" onClick={() => { draftRef.current.adoptLatestBasis(identity); sync(); setError(undefined); }}>최신 문서 기준으로 계속 작성</button>
    </div>}
    {canEdit && snapshot.dirty && <button type="button" onClick={() => {
      if (snapshot.latestServer === undefined) {
        draftRef.current.discard(inputFromArtifact(snapshot.basis.artifact), snapshot.basis);
      } else {
        draftRef.current.discardToLatest(identity);
      }
      sync();
      setError(undefined);
    }}>작성 중 문서 폐기</button>}
    {canEdit && <button className="primary-button" type="button" disabled={pending} onClick={submit}>{pending ? '저장 중…' : '문서 저장'}</button>}
    {snapshot.basis.artifact !== undefined && <VersionComparison actorId={actorId} projectId={projectId} srId={srId} artifact={snapshot.basis.artifact} />}
  </section>;
}

export function ArtifactWorkspace({ actorId, projectId, detail, targets, onSaved, onRefresh }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: {
    readonly sr: { readonly scope: { readonly srId: string }; readonly ownerId: string };
    readonly artifacts: readonly ArtifactView[];
    readonly decisions: readonly DecisionView[];
    readonly sources: readonly ContextSourceView[];
    readonly questions: readonly QuestionView[];
  };
  readonly targets: readonly ArtifactTargetOption[];
  onSaved(): void;
  onRefresh(): void;
}) {
  const [selected, setSelected] = useState(targets[0]?.logicalKey ?? 'requirements');
  return <section className="artifact-workspace-shell">
    {targets.length > 1 && <label>문서 대상<select value={selected} onChange={(event) => setSelected(event.target.value as ArtifactTargetOption['logicalKey'])}>{targets.map((target) => <option key={target.logicalKey} value={target.logicalKey}>{target.label}</option>)}</select></label>}
    {targets.map((target) => <div key={`${actorId}:${detail.sr.scope.srId}:${target.logicalKey}`} hidden={selected !== target.logicalKey}>
      <ArtifactEditor
        actorId={actorId}
        projectId={projectId}
        srId={detail.sr.scope.srId}
        ownerId={detail.sr.ownerId}
        target={target}
        {...(() => {
          const current = detail.artifacts.find((artifact) => matchesTarget(artifact, target.logicalKey));
          return current === undefined ? {} : { artifact: current };
        })()}
        decisions={detail.decisions}
        sources={detail.sources}
        questions={detail.questions}
        onSaved={onSaved}
        onRefresh={onRefresh}
      />
    </div>)}
  </section>;
}
