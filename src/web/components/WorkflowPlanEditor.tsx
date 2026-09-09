import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtifactVersionRef, RevisionOrAbsentGuard } from '@/src/contracts/context';
import type {
  ArtifactView,
  NonEmpty,
  RequirementLink,
  SRDetailView,
  WorkflowPlanEdit,
  WorkflowPlanView,
  WorkflowStageInput,
} from '@/src/contracts/views';
import { deriveArtifactSectionIndex } from '@/src/domain/artifact-rules';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { FormDraft, type FormDraftIdentity } from '../state/form-draft';
import { CommandFeedback, type CommandFeedbackState } from './CommandFeedback';
import './WorkflowPlanEditor.css';

const DESIGN_STAGES = [
  { id: 'application_design', designStage: 'application', label: '애플리케이션 설계' },
  { id: 'functional_design', designStage: 'functional', label: '기능 설계' },
  { id: 'nfr_design', designStage: 'nfr', label: '품질·성능 설계' },
  { id: 'infrastructure_design', designStage: 'infrastructure', label: '인프라 설계' },
] as const;

type DesignStageDefinition = (typeof DESIGN_STAGES)[number];
type DesignStageId = DesignStageDefinition['id'];

interface StageDraft {
  readonly stageId: DesignStageId;
  readonly choice: 'executed' | 'skipped';
  readonly designRefKey: string;
  readonly reason: string;
}

interface TaskDraft {
  readonly taskId: string;
  readonly requirementIds: NonEmpty<string>;
  readonly verification: string;
}

interface WorkflowFormInput {
  readonly progressDescription: string;
  readonly stages: readonly StageDraft[];
  readonly retainedStages: readonly WorkflowStageInput[];
  readonly tasks: readonly TaskDraft[];
}

interface WorkflowBasis {
  readonly workflow?: WorkflowPlanView;
}

type WorkflowAttempt = CommandAttempt<WorkflowPlanEdit, RevisionOrAbsentGuard<'artifact'>>;

function isWorkflowPlan(artifact: ArtifactView): artifact is WorkflowPlanView {
  return artifact.kind === 'workflow_plan' &&
    'workflowVersion' in artifact &&
    'stages' in artifact &&
    'requirementTaskLinks' in artifact;
}

function refKey(ref: ArtifactVersionRef): string {
  return `${ref.entityId}:${ref.version}`;
}

function currentWorkflow(detail: SRDetailView): WorkflowPlanView | undefined {
  return detail.artifacts.find(isWorkflowPlan);
}

function currentRequirements(detail: SRDetailView): ArtifactView | undefined {
  return detail.artifacts.find((artifact) => artifact.kind === 'requirements');
}

function currentDesigns(detail: SRDetailView, stage: DesignStageDefinition): readonly ArtifactView[] {
  return detail.artifacts.filter((artifact) => artifact.kind === 'design' && artifact.designStage === stage.designStage);
}

function documentTitle(artifact: ArtifactView): string {
  return artifact.sectionIndex[0]?.title.trim() || `${artifact.designStage ?? artifact.kind} 문서`;
}

function summaryFromWorkflow(workflow: WorkflowPlanView | undefined): string {
  if (workflow === undefined) return '';
  const section = workflow.sectionIndex.find((entry) => entry.sectionId === 'PLAN-SUMMARY');
  if (section === undefined) return workflow.changeSummary;
  const content = workflow.markdown.slice(section.startOffset, section.endOffset);
  return content.replace(/^##[^\n]*(?:\r?\n)?/u, '').trim();
}

function createTaskId(): string {
  return `TASK-${crypto.randomUUID()}`;
}

function initialForm(detail: SRDetailView): WorkflowFormInput {
  const workflow = currentWorkflow(detail);
  const requirements = currentRequirements(detail)?.requirementLinks ?? [];
  const covered = new Set<string>();
  const tasks: TaskDraft[] = [];

  for (const task of workflow?.requirementTaskLinks ?? []) {
    const currentIds = task.requirementIds.filter((id) => requirements.some((item) => item.requirementId === id));
    const nonEmptyIds = nonEmpty(currentIds);
    if (nonEmptyIds === undefined) continue;
    currentIds.forEach((id) => covered.add(id));
    tasks.push({ taskId: task.taskId, requirementIds: nonEmptyIds, verification: task.verification.join('\n') });
  }
  for (const requirement of requirements) {
    if (covered.has(requirement.requirementId)) continue;
    tasks.push({
      taskId: createTaskId(),
      requirementIds: [requirement.requirementId],
      verification: requirement.acceptanceCriteria.join('\n'),
    });
  }

  return {
    progressDescription: summaryFromWorkflow(workflow),
    stages: DESIGN_STAGES.map((stage): StageDraft => {
      const stored = workflow?.stages.find((item) => item.stageId === stage.id);
      if (stored?.choice === 'executed') {
        return {
          stageId: stage.id,
          choice: 'executed',
          designRefKey: stored.designArtifactRefs[0] === undefined ? '' : refKey(stored.designArtifactRefs[0]),
          reason: '',
        };
      }
      return {
        stageId: stage.id,
        choice: 'skipped',
        designRefKey: '',
        reason: stored?.choice === 'skipped' ? stored.reason : '',
      };
    }),
    retainedStages: workflow?.stages.filter((stage) =>
      !DESIGN_STAGES.some((definition) => definition.id === stage.stageId)) ?? [],
    tasks,
  };
}

function nonEmpty<T>(items: readonly T[]): NonEmpty<T> | undefined {
  const [first, ...rest] = items;
  return first === undefined ? undefined : [first, ...rest];
}

function verificationLines(value: string): NonEmpty<string> | undefined {
  return nonEmpty(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean));
}

function sectionId(requirementId: string): string {
  return `WF-${requirementId}`;
}

function buildMarkdown(input: WorkflowFormInput, requirements: readonly RequirementLink[]): string {
  const blocks = [
    `## PLAN-SUMMARY 진행 설명\n${input.progressDescription.trim()}`,
    ...requirements.map((requirement) => {
      const tasks = input.tasks.filter((task) => task.requirementIds.includes(requirement.requirementId));
      const taskLines = tasks.flatMap((task) => [
        `### ${task.taskId}`,
        ...(verificationLines(task.verification) ?? []).map((line) => `- ${line}`),
      ]);
      return `## ${sectionId(requirement.requirementId)} ${requirement.requirementId} 검증 계획\n${taskLines.join('\n')}`;
    }),
  ];
  return `${blocks.join('\n\n')}\n`;
}

function buildEdit(
  detail: SRDetailView,
  basis: WorkflowBasis,
  input: WorkflowFormInput,
): WorkflowPlanEdit {
  const requirementsArtifact = currentRequirements(detail);
  if (requirementsArtifact === undefined || requirementsArtifact.requirementLinks.length === 0) {
    throw new Error('먼저 요구사항 문서와 수용 기준을 저장하세요.');
  }
  if (input.progressDescription.trim().length === 0) {
    throw new Error('이 계획으로 어떻게 진행할지 설명하세요.');
  }

  const stages = input.stages.map((draft): WorkflowStageInput => {
    const definition = DESIGN_STAGES.find((stage) => stage.id === draft.stageId)!;
    if (draft.choice === 'skipped') {
      if (draft.reason.trim().length === 0) throw new Error(`${definition.label}을 생략하는 이유를 입력하세요.`);
      return { stageId: draft.stageId, choice: 'skipped', reason: draft.reason.trim() };
    }
    const design = currentDesigns(detail, definition).find((artifact) => refKey(artifact.versionRef) === draft.designRefKey);
    if (design === undefined) throw new Error(`${definition.label}을 수행하려면 저장된 현재 설계 문서를 선택하세요.`);
    return { stageId: draft.stageId, choice: 'executed', designArtifactRefs: [design.versionRef] };
  });

  const stageList = nonEmpty([...stages, ...input.retainedStages]);
  if (stageList === undefined) throw new Error('설계 단계를 하나 이상 정리하세요.');
  const tasks = input.tasks.map((task, index) => {
    const verification = verificationLines(task.verification);
    if (verification === undefined) {
      throw new Error(`${task.requirementIds.join(', ')}의 검증 계획을 한 줄 이상 입력하세요.`);
    }
    return { taskId: task.taskId, requirementIds: task.requirementIds, verification, order: index + 1 };
  });
  const taskList = nonEmpty(tasks);
  if (taskList === undefined) throw new Error('요구사항에 연결된 검증 계획이 없습니다.');

  const markdown = buildMarkdown(input, requirementsArtifact.requirementLinks);
  const sectionIds = ['PLAN-SUMMARY', ...requirementsArtifact.requirementLinks.map((link) => sectionId(link.requirementId))];
  const workflow = basis.workflow;
  return {
    ...(workflow === undefined ? {} : { artifactId: workflow.artifactId }),
    kind: 'workflow_plan',
    markdown,
    sectionIndex: deriveArtifactSectionIndex(markdown, sectionIds),
    requirementLinks: requirementsArtifact.requirementLinks.map((link) => ({
      requirementId: link.requirementId,
      sectionIds: [sectionId(link.requirementId)],
      acceptanceCriteria: link.acceptanceCriteria,
    })),
    changeSummary: workflow === undefined ? '진행 계획과 검증 계획을 처음 정리했습니다.' : '진행 계획과 검증 계획을 수정했습니다.',
    targetBasis: workflow === undefined
      ? { kind: 'absent', logicalKey: 'workflow_plan' }
      : { kind: 'version', ref: workflow.versionRef },
    decisionRefs: workflow?.decisionRefs ?? requirementsArtifact.decisionRefs,
    sourceRefs: workflow?.sourceRefs ?? requirementsArtifact.sourceRefs,
    questionResultRefs: workflow?.questionResultRefs ?? requirementsArtifact.questionResultRefs,
    workflowVersion: 'v1.0.1',
    stages: stageList,
    implementationUnitCount: 1,
    requirementTaskLinks: taskList,
  };
}

function basisIdentity(workflow: WorkflowPlanView | undefined, requirements: ArtifactView | undefined): string {
  const workflowIdentity = workflow === undefined ? 'absent' : `${workflow.artifactId}:${workflow.revision}`;
  const requirementIdentity = requirements === undefined
    ? 'requirements-absent'
    : `${requirements.artifactId}:${requirements.revision}`;
  return `${workflowIdentity}:${requirementIdentity}`;
}

function formIdentity(actorId: string, projectId: string, srId: string): FormDraftIdentity {
  return { actorId, scope: { kind: 'sr', projectId, srId }, target: 'workflow_plan', form: 'workflow-plan' };
}

function localError(error: unknown) {
  return {
    code: 'STORE_UNAVAILABLE' as const,
    message: error instanceof Error ? error.message : '진행 계획을 저장하지 못했습니다.',
    blockers: [], assigneeIds: [], targetRefs: [],
  };
}

export function WorkflowPlanEditor({ actorId, projectId, detail, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  onSaved(): void;
}) {
  const srId = detail.sr.scope.srId;
  const workflow = currentWorkflow(detail);
  const requirements = currentRequirements(detail);
  const identity = useMemo(() => formIdentity(actorId, projectId, srId), [actorId, projectId, srId]);
  const draft = useMemo(() => new FormDraft(identity, initialForm(detail), {
    ...(workflow === undefined ? {} : { workflow }),
  }), [identity]);
  const session = useMemo(() => new CommandSession(), [identity]);
  const mounted = useRef(false);
  const serverIdentity = useRef(basisIdentity(workflow, requirements));
  const [snapshot, setSnapshot] = useState(draft.snapshot());
  const [feedback, setFeedback] = useState<CommandFeedbackState>({ kind: 'idle' });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const nextIdentity = basisIdentity(workflow, requirements);
    if (serverIdentity.current === nextIdentity) return;
    serverIdentity.current = nextIdentity;
    draft.refreshFromServer(initialForm(detail), { ...(workflow === undefined ? {} : { workflow }) });
    setSnapshot(draft.snapshot());
  }, [detail, draft, requirements, workflow]);

  const edit = (input: WorkflowFormInput) => {
    draft.edit(input);
    draft.setFieldErrors({});
    setSnapshot(draft.snapshot());
    setFeedback({ kind: 'idle' });
  };

  const execute = async (attempt: WorkflowAttempt) => {
    if (!session.beginExecution(attempt)) return;
    setFeedback({ kind: 'processing' });
    try {
      const result = await invoke('M-017', {
        actorId,
        projectId,
        srId,
        idempotencyKey: attempt.idempotencyKey,
        guard: attempt.submission.guard,
      }, attempt.submission.input);
      if (!mounted.current) return;
      const resolution = session.resolve(attempt, asCommandResult(result), {
        actorId,
        scope: { kind: 'sr', projectId, srId },
        target: 'workflow_plan',
        command: 'M-017',
      });
      if (!resolution.appliesToCurrentForm) return;
      if (resolution.result.kind === 'rejected') {
        setFeedback({ kind: 'rejected', error: resolution.result.error });
        if (resolution.result.error.code === 'STALE_VERSION') onSaved();
        return;
      }
      const saved = resolution.result.value;
      serverIdentity.current = basisIdentity(saved, requirements);
      let liveMatchesAttempt = false;
      try {
        liveMatchesAttempt = JSON.stringify(buildEdit(detail, draft.snapshot().basis, draft.snapshot().input)) ===
          JSON.stringify(attempt.submission.input);
      } catch {
        liveMatchesAttempt = false;
      }
      if (liveMatchesAttempt) {
        const savedDetail = {
          ...detail,
          artifacts: [...detail.artifacts.filter((item) => item.kind !== 'workflow_plan'), saved],
        };
        draft.markSaved(initialForm(savedDetail), { workflow: saved });
        setSnapshot(draft.snapshot());
      }
      setFeedback(resolution.result.kind === 'replayed'
        ? { kind: 'replayed', message: '이미 저장된 진행 계획을 확인했습니다.', receiptId: resolution.result.priorReceipt.receiptId }
        : { kind: 'committed', message: '진행 계획을 저장했습니다.' });
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof TransportUncertainError) {
        session.markResultUnknown(attempt);
        setFeedback({ kind: 'confirmation-required', retry: () => { void execute(session.retry(attempt)); } });
      } else {
        setFeedback({ kind: 'rejected', error: localError(error) });
      }
    } finally {
      session.endExecution(attempt);
    }
  };

  const submit = () => {
    let input: WorkflowPlanEdit;
    try {
      input = buildEdit(detail, snapshot.basis, snapshot.input);
    } catch (error) {
      setFeedback({ kind: 'rejected', error: {
        code: 'VALIDATION_ERROR',
        message: error instanceof Error ? error.message : '입력한 진행 계획을 확인하세요.',
        blockers: [], assigneeIds: [], targetRefs: [],
      } });
      return;
    }
    const guard: RevisionOrAbsentGuard<'artifact'> = snapshot.basis.workflow === undefined
      ? { resource: { target: { kind: 'artifact_logical_key', projectId, srId, logicalKey: 'workflow_plan' }, expected: 'absent' } }
      : { resource: { target: { kind: 'artifact', projectId, srId, entityId: snapshot.basis.workflow.artifactId }, expectedRevision: snapshot.basis.workflow.revision } };
    void execute(session.submit({
      actorId,
      scope: { kind: 'sr', projectId, srId },
      target: 'workflow_plan',
      command: 'M-017',
      input,
      guard,
    }));
  };

  const canEdit = detail.sr.ownerId === actorId;
  const updateStage = (stageId: DesignStageId, patch: Partial<StageDraft>) => edit({
    ...snapshot.input,
    stages: snapshot.input.stages.map((stage) => stage.stageId === stageId ? { ...stage, ...patch } : stage),
  });

  return <section className="workflow-plan-editor" data-testid="workflow-plan-editor">
    <header>
      <div><p className="eyebrow">진행 계획</p><h3>어떤 설계를 거쳐 구현할지 정합니다</h3></div>
      <span>{workflow === undefined ? '새 계획' : `계획 v${workflow.versionRef.version}`}</span>
    </header>
    <p className="workflow-plan-editor__intro">요구사항마다 검증 방법을 적고, 필요한 설계 문서를 선택합니다. 내부 연결은 저장할 때 자동으로 만듭니다.</p>
    {!canEdit && <p className="quiet">현재 담당자만 진행 계획을 저장할 수 있습니다.</p>}
    {requirements === undefined || requirements.requirementLinks.length === 0 ? <div className="workflow-plan-editor__empty">
      <strong>먼저 요구사항을 정리하세요.</strong><p>저장된 요구사항과 수용 기준이 있어야 진행 계획을 만들 수 있습니다.</p>
    </div> : <>
      <label>진행 설명<textarea rows={4} readOnly={!canEdit} value={snapshot.input.progressDescription} placeholder="이 요구사항을 어떤 순서와 기준으로 구현할지 설명합니다." onChange={(event) => edit({ ...snapshot.input, progressDescription: event.target.value })} /></label>
      <div className="workflow-plan-editor__stages">
        <h4>설계 단계</h4>
        {DESIGN_STAGES.map((definition) => {
          const stage = snapshot.input.stages.find((item) => item.stageId === definition.id)!;
          const designs = currentDesigns(detail, definition);
          return <fieldset key={definition.id}>
            <legend>{definition.label}</legend>
            <div className="workflow-plan-editor__choice">
              <label><input type="radio" name={definition.id} disabled={!canEdit} checked={stage.choice === 'executed'} onChange={() => updateStage(definition.id, { choice: 'executed', reason: '' })} />수행</label>
              <label><input type="radio" name={definition.id} disabled={!canEdit} checked={stage.choice === 'skipped'} onChange={() => updateStage(definition.id, { choice: 'skipped', designRefKey: '' })} />생략</label>
            </div>
            {stage.choice === 'executed' ? designs.length === 0 ? <p className="workflow-plan-editor__guidance">저장된 {definition.label} 문서가 없습니다. 아래 ‘필요한 설계 문서 작성’에서 먼저 작성하세요.</p> : <label>현재 설계 문서<select disabled={!canEdit} value={stage.designRefKey} onChange={(event) => updateStage(definition.id, { designRefKey: event.target.value })}>
              <option value="">문서를 선택하세요</option>
              {designs.map((design) => <option key={refKey(design.versionRef)} value={refKey(design.versionRef)}>{documentTitle(design)} · v{design.versionRef.version}</option>)}
            </select></label> : <label>생략 이유<textarea rows={2} readOnly={!canEdit} value={stage.reason} placeholder="이 요청에서는 왜 이 설계가 필요하지 않은지 적습니다." onChange={(event) => updateStage(definition.id, { reason: event.target.value })} /></label>}
          </fieldset>;
        })}
      </div>
      {snapshot.input.retainedStages.length > 0 && <div className="workflow-plan-editor__verification">
        <h4>기존 계획의 다른 단계</h4>
        <p className="quiet">현재 편집 항목에 없는 저장 단계는 변경하거나 삭제하지 않고 그대로 유지합니다.</p>
        <ul>{snapshot.input.retainedStages.map((stage) => <li key={stage.stageId}><strong>{stage.stageId}</strong> · {stage.choice === 'executed' ? `수행 · 설계 문서 ${stage.designArtifactRefs.length}개` : `생략 · ${stage.reason}`}</li>)}</ul>
      </div>}
      <div className="workflow-plan-editor__verification">
        <h4>요구사항별 검증 계획</h4>
        {snapshot.input.tasks.map((task, index) => <label key={task.taskId}>
          <span>{task.requirementIds.join(', ')}</span>
          <textarea rows={3} readOnly={!canEdit} value={task.verification} placeholder="한 줄에 하나씩 검증 방법을 적습니다." onChange={(event) => edit({ ...snapshot.input, tasks: snapshot.input.tasks.map((item, itemIndex) => itemIndex === index ? { ...item, verification: event.target.value } : item) })} />
        </label>)}
      </div>
      {snapshot.latestServer !== undefined && <div className="workflow-plan-editor__conflict" role="alert">
        <strong>서버의 진행 계획이 바뀌었습니다.</strong><p>작성 중인 입력은 유지했습니다. 최신 version을 기준으로 계속하거나 현재 입력을 폐기할 수 있습니다.</p>
        <div><button type="button" onClick={() => { if (draft.adoptLatestBasis(identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } }}>현재 입력에 최신 version 적용</button><button type="button" onClick={() => { if (draft.discardToLatest(identity)) { setSnapshot(draft.snapshot()); setFeedback({ kind: 'idle' }); } }}>입력 폐기</button></div>
      </div>}
      {snapshot.dirty && <p className="dirty-indicator">저장하지 않은 진행 계획이 있습니다.</p>}
      {canEdit && <button className="primary-button" type="button" onClick={submit} disabled={feedback.kind === 'processing'}>{feedback.kind === 'processing' ? '저장 중…' : '진행 계획 저장'}</button>}
      <CommandFeedback state={feedback} />
    </>}
  </section>;
}
