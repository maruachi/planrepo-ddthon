import { useEffect, useRef, useState } from 'react';
import type {
  AppliedDraftView,
  ArtifactTargetBasis,
  DecisionProposal,
  DraftApplication,
  DraftView,
  GenerationResult,
  QuestionProposal,
  QuestionClassificationInput,
  ReviewedDraftInput,
  SRDetailView,
  WorkflowPlanView,
} from '@/src/contracts/views';
import type { DraftApplicationGuard, FingerprintGuard } from '@/src/contracts/context';
import { deriveArtifactSectionIndex } from '@/src/domain/artifact-rules';
import { parseArtifactLogicalKey } from '@/src/domain/artifact-target';
import { asCommandResult, invoke, TransportUncertainError } from '../api/client';
import { CommandSession, type CommandAttempt } from '../state/command-session';
import { compareInputContents } from '../state/draft-input-comparison';
import { FormDraft, type FormDraftIdentity } from '../state/form-draft';

interface RequirementForm {
  readonly requirementId: string;
  readonly sectionIds: string;
  readonly acceptanceCriteria: string;
}

interface DecisionSelectionForm {
  readonly temporaryId: string;
  readonly selected: boolean;
  readonly decisionMakerId: string;
  readonly scope: 'current' | 'followup';
  readonly requiredGate: 'G1' | 'G2';
  readonly reason: string;
  readonly followupOwnerId: string;
  readonly revisitEvent: string;
}

interface WorkflowStageForm {
  readonly stageId: string;
  readonly choice: 'executed' | 'skipped';
  readonly reason: string;
  readonly designArtifactRefs: string;
}

interface WorkflowTaskForm {
  readonly taskId: string;
  readonly requirementIds: string;
  readonly verification: string;
  readonly order: string;
}

interface DraftFormInput {
  readonly body: GenerationResult;
  readonly comparisonSummary: string;
  readonly applicationReason: string;
  readonly selectedQuestionIds: readonly string[];
  readonly decisionSelections: readonly DecisionSelectionForm[];
  readonly sectionIds: string;
  readonly requirements: readonly RequirementForm[];
  readonly workflowStages: readonly WorkflowStageForm[];
  readonly workflowTasks: readonly WorkflowTaskForm[];
}

interface DraftFormBasis {
  readonly detail: SRDetailView;
  readonly draft: DraftView;
}

type ReviewAttempt = CommandAttempt<ReviewedDraftInput, FingerprintGuard>;
type ApplyAttempt = CommandAttempt<DraftApplication, DraftApplicationGuard>;

function freshnessLabel(value: DraftView['freshness']): string {
  if (value === 'current') return '현재 입력';
  if (value === 'stale') return '오래됨';
  return `현재성 미확인: ${value.reason}`;
}

function provenanceLabel(value: DraftView['provenance']): string {
  return value.kind === 'provider'
    ? 'AI가 만든 제안'
    : '사람이 내용을 검토한 제안';
}

function splitValues(value: string): string[] {
  return value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean);
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

function currentArtifact(detail: SRDetailView, target: ArtifactTargetBasis | undefined) {
  if (target?.kind !== 'version') return undefined;
  return detail.artifacts.find((artifact) => artifact.artifactId === target.ref.entityId);
}

function artifactRows(detail: SRDetailView, draft: DraftView) {
  if (draft.body.kind !== 'artifact') return {
    sectionIds: '', requirements: [] as RequirementForm[], workflowStages: [] as WorkflowStageForm[],
    workflowTasks: [] as WorkflowTaskForm[],
  };
  const preparation = detail.preparation?.kind === 'draft' ? detail.preparation : undefined;
  const artifact = currentArtifact(detail, preparation?.currentTargetBasis);
  const matches = artifact !== undefined &&
    artifact.requirementLinks.map(({ requirementId }) => requirementId).join('\n') === draft.body.requirementRefs.join('\n');
  const requirements = draft.body.requirementRefs.map((requirementId) => {
    const existing = matches
      ? artifact.requirementLinks.find((item) => item.requirementId === requirementId)
      : undefined;
    return {
      requirementId,
      sectionIds: existing?.sectionIds.join('\n') ?? requirementId,
      acceptanceCriteria: existing?.acceptanceCriteria.join('\n') ?? '',
    };
  });
  const sectionIds = matches
    ? artifact.sectionIndex.map(({ sectionId }) => sectionId).join('\n')
    : draft.body.requirementRefs.join('\n');
  const workflow = artifact?.kind === 'workflow_plan' ? artifact as WorkflowPlanView : undefined;
  return {
    sectionIds,
    requirements,
    workflowStages: workflow?.stages.map((stage) => stage.choice === 'executed' ? {
      stageId: stage.stageId,
      choice: stage.choice,
      reason: '',
      designArtifactRefs: stage.designArtifactRefs.map(({ entityId, version }) => `${entityId}@${version}`).join('\n'),
    } : {
      stageId: stage.stageId, choice: stage.choice, reason: stage.reason, designArtifactRefs: '',
    }) ?? [{ stageId: '', choice: 'skipped' as const, reason: '', designArtifactRefs: '' }],
    workflowTasks: workflow?.requirementTaskLinks.map((link) => ({
      taskId: link.taskId,
      requirementIds: link.requirementIds.join('\n'),
      verification: link.verification.join('\n'),
      order: String(link.order),
    })) ?? [{ taskId: '', requirementIds: '', verification: '', order: '1' }],
  };
}

function inputFromDetail(detail: SRDetailView): DraftFormInput {
  const draft = detail.draftReview?.draft;
  if (draft === undefined) throw new Error('선택 초안 본문이 없습니다.');
  const artifact = artifactRows(detail, draft);
  return {
    body: draft.body,
    comparisonSummary: draft.provenance.kind === 'human_review' ? draft.provenance.comparisonSummary : '',
    applicationReason: '',
    selectedQuestionIds: [],
    decisionSelections: draft.body.kind === 'decision_proposals'
      ? draft.body.proposals.map(({ temporaryId }) => ({
          temporaryId, selected: false, decisionMakerId: '', scope: 'current' as const,
          requiredGate: 'G1' as const, reason: '', followupOwnerId: '', revisitEvent: '',
        }))
      : [],
    ...artifact,
  };
}

function formIdentity(actorId: string, projectId: string, srId: string, draftId: string): FormDraftIdentity {
  return { actorId, scope: { kind: 'sr', projectId, srId }, target: draftId, form: 'draft-review' };
}

function refLabel(ref: { readonly kind: string; readonly entityId: string; readonly version?: number }): string {
  return `${ref.kind}:${ref.entityId}${ref.version === undefined ? '' : ` v${ref.version}`}`;
}

function targetLabel(target: ArtifactTargetBasis | undefined): string {
  if (target === undefined) return '문서 대상 없음';
  return target.kind === 'absent'
    ? `${target.logicalKey} · 문서 없음`
    : `artifact:${target.ref.entityId} v${target.ref.version}`;
}

function classification(selection: DecisionSelectionForm): QuestionClassificationInput {
  if (selection.scope === 'current') {
    return { scope: 'current', requiredGate: selection.requiredGate, reason: selection.reason };
  }
  return {
    scope: 'followup', requiredGate: 'None', reason: selection.reason,
    ownerId: selection.followupOwnerId,
    revisit: { kind: 'event', event: selection.revisitEvent },
  };
}

function logicalKey(detail: SRDetailView, draft: DraftView, target: ArtifactTargetBasis): string {
  if (target.kind === 'absent') return target.logicalKey;
  const artifact = detail.artifacts.find((item) => item.artifactId === target.ref.entityId);
  if (artifact === undefined) throw new Error('현재 문서 target을 찾을 수 없습니다.');
  return artifact.kind === 'design' ? `design:${artifact.designStage}` : artifact.kind;
}

function buildArtifactApplication(detail: SRDetailView, input: DraftFormInput): DraftApplication {
  if (input.body.kind !== 'artifact' || detail.preparation?.kind !== 'draft' ||
    detail.preparation.currentTargetBasis === undefined) throw new Error('현재 문서 적용 기준이 없습니다.');
  const targetBasis = detail.preparation.currentTargetBasis;
  const key = parseArtifactLogicalKey(logicalKey(detail, detail.draftReview!.draft, targetBasis));
  const sectionIds = splitLines(input.sectionIds);
  const requirementLinks = input.requirements.map((item) => ({
    requirementId: item.requirementId.trim(),
    sectionIds: splitValues(item.sectionIds) as [string, ...string[]],
    acceptanceCriteria: splitLines(item.acceptanceCriteria),
  }));
  const common = {
    markdown: input.body.markdown,
    sectionIndex: deriveArtifactSectionIndex(input.body.markdown, sectionIds),
    requirementLinks,
    changeSummary: input.body.changeSummary,
    targetBasis,
    ...(targetBasis.kind === 'version' ? { artifactId: targetBasis.ref.entityId } : {}),
  };
  if (key.kind === 'workflow_plan') {
    const stages = input.workflowStages.map((stage) => stage.choice === 'executed' ? {
      stageId: stage.stageId.trim(), choice: 'executed' as const,
      designArtifactRefs: splitLines(stage.designArtifactRefs).map((value) => {
        const [entityId, rawVersion] = value.split('@');
        const artifact = detail.artifacts.find((item) => item.artifactId === entityId &&
          item.versionRef.version === Number(rawVersion));
        if (artifact === undefined) throw new Error(`설계 문서 ref ${value}를 현재 상세에서 찾을 수 없습니다.`);
        return artifact.versionRef;
      }),
    } : { stageId: stage.stageId.trim(), choice: 'skipped' as const, reason: stage.reason } as const);
    const requirementTaskLinks = input.workflowTasks.map((task) => ({
      taskId: task.taskId.trim(),
      requirementIds: splitValues(task.requirementIds) as [string, ...string[]],
      verification: splitLines(task.verification) as [string, ...string[]],
      order: Number(task.order),
    }));
    return {
      draftId: detail.draftReview!.draft.draftId,
      applicationReason: input.applicationReason,
      selectedContent: { kind: 'artifact', edit: {
        ...common, kind: 'workflow_plan', workflowVersion: 'v1.0.1',
        stages: stages as [typeof stages[number], ...typeof stages], implementationUnitCount: 1,
        requirementTaskLinks: requirementTaskLinks as [typeof requirementTaskLinks[number], ...typeof requirementTaskLinks],
      } },
    };
  }
  const edit = key.kind === 'design'
    ? { ...common, kind: 'design' as const, designStage: key.designStage! }
    : { ...common, kind: key.kind };
  return {
    draftId: detail.draftReview!.draft.draftId,
    applicationReason: input.applicationReason,
    selectedContent: { kind: 'artifact', edit },
  };
}

function buildApplication(detail: SRDetailView, input: DraftFormInput): DraftApplication {
  const draft = detail.draftReview?.draft;
  if (draft === undefined) throw new Error('선택 초안이 없습니다.');
  if (draft.body.kind === 'artifact') return buildArtifactApplication(detail, input);
  if (draft.body.kind === 'question_proposals') {
    const temporaryIds = input.selectedQuestionIds as [string, ...string[]];
    if (temporaryIds.length === 0) throw new Error('적용할 질문을 하나 이상 선택하세요.');
    return { draftId: draft.draftId, applicationReason: input.applicationReason,
      selectedContent: { kind: 'questions', temporaryIds } };
  }
  const selected = input.decisionSelections.filter((item) => item.selected).map((item) => ({
    temporaryId: item.temporaryId,
    decisionMakerId: item.decisionMakerId,
    classification: classification(item),
  })) as [{ temporaryId: string; decisionMakerId: string; classification: QuestionClassificationInput }, ...Array<{
    temporaryId: string; decisionMakerId: string; classification: QuestionClassificationInput;
  }>];
  if (selected.length === 0) throw new Error('적용할 결정을 하나 이상 선택하세요.');
  return { draftId: draft.draftId, applicationReason: input.applicationReason,
    selectedContent: { kind: 'decisions', selections: selected } };
}

function applicationGuard(detail: SRDetailView, input: DraftApplication): DraftApplicationGuard {
  const preparation = detail.preparation;
  if (preparation?.kind !== 'draft') throw new Error('현재 입력 fingerprint가 없습니다.');
  if (input.selectedContent.kind !== 'artifact') {
    return { kind: input.selectedContent.kind, expectedInputFingerprint: preparation.currentInputFingerprint };
  }
  const target = input.selectedContent.edit.targetBasis;
  if (target.kind === 'absent') {
    return { kind: 'artifact', expectedInputFingerprint: preparation.currentInputFingerprint, target: {
      target: { kind: 'artifact_logical_key', projectId: detail.sr.scope.projectId,
        srId: detail.sr.scope.srId, logicalKey: target.logicalKey }, expected: 'absent',
    } };
  }
  const artifact = detail.artifacts.find((item) => item.artifactId === target.ref.entityId);
  if (artifact === undefined) throw new Error('현재 문서 revision을 찾을 수 없습니다.');
  return { kind: 'artifact', expectedInputFingerprint: preparation.currentInputFingerprint, target: {
    target: { kind: 'artifact', projectId: target.ref.projectId, srId: target.ref.srId,
      entityId: target.ref.entityId }, expectedRevision: artifact.revision,
  } };
}

function ArtifactFields({ input, patch, canEdit }: {
  readonly input: DraftFormInput;
  patch(value: Partial<DraftFormInput>): void;
  readonly canEdit: boolean;
}) {
  if (input.body.kind !== 'artifact') return null;
  const artifactBody = input.body;
  const setBody = (body: Partial<Pick<typeof artifactBody, 'markdown' | 'changeSummary'>>) =>
    patch({ body: { ...artifactBody, ...body } });
  const setRequirements = (requirements: readonly RequirementForm[]) => patch({
    requirements,
    body: { ...artifactBody, requirementRefs: requirements.map(({ requirementId }) => requirementId.trim()) },
  });
  return <>
    <label>Markdown 원문<textarea rows={12} value={input.body.markdown} readOnly={!canEdit}
      onChange={(event) => setBody({ markdown: event.target.value })} /></label>
    <label>변경 요약<textarea value={input.body.changeSummary} readOnly={!canEdit}
      onChange={(event) => setBody({ changeSummary: event.target.value })} /></label>
    <label>섹션 ID<textarea aria-label="섹션 ID" value={input.sectionIds} readOnly={!canEdit}
      onChange={(event) => patch({ sectionIds: event.target.value })} /><small>Markdown의 level-2 제목 ID를 한 줄에 하나씩 입력합니다.</small></label>
    <section className="draft-structure"><h4>요구사항 구조</h4>
      {input.requirements.map((item, index) => <fieldset key={index}>
        <legend>요구사항 {index + 1}</legend>
        <label>요구사항 ID<input value={item.requirementId} readOnly={!canEdit} onChange={(event) => {
          const requirements = input.requirements.map((row, rowIndex) => rowIndex === index
            ? { ...row, requirementId: event.target.value } : row);
          setRequirements(requirements);
        }} /></label>
        <label>연결 섹션 ID<input value={item.sectionIds} readOnly={!canEdit} onChange={(event) => patch({
          requirements: input.requirements.map((row, rowIndex) => rowIndex === index
            ? { ...row, sectionIds: event.target.value } : row),
        })} /></label>
        <label>수용 기준<textarea value={item.acceptanceCriteria} readOnly={!canEdit} onChange={(event) => patch({
          requirements: input.requirements.map((row, rowIndex) => rowIndex === index
            ? { ...row, acceptanceCriteria: event.target.value } : row),
        })} /></label>
        {canEdit && <button type="button" onClick={() => setRequirements(
          input.requirements.filter((_, rowIndex) => rowIndex !== index),
        )}>요구사항 {index + 1} 삭제</button>}
      </fieldset>)}
      {canEdit && <button type="button" onClick={() => setRequirements([...input.requirements, {
        requirementId: '', sectionIds: '', acceptanceCriteria: '',
      }])}>요구사항 추가</button>}
    </section>
  </>;
}

function WorkflowFields({ input, patch, canEdit }: {
  readonly input: DraftFormInput;
  patch(value: Partial<DraftFormInput>): void;
  readonly canEdit: boolean;
}) {
  if (input.body.kind !== 'artifact' || input.body.documentKind !== 'workflow_plan') return null;
  return <section className="draft-structure"><h4>진행 계획 구조</h4>
    {input.workflowStages.map((stage, index) => <fieldset key={index}>
      <legend>단계 {index + 1}</legend>
      <label>단계 ID<input value={stage.stageId} readOnly={!canEdit} onChange={(event) => patch({
        workflowStages: input.workflowStages.map((row, rowIndex) => rowIndex === index
          ? { ...row, stageId: event.target.value } : row),
      })} /></label>
      <label>처리<select value={stage.choice} disabled={!canEdit} onChange={(event) => patch({
        workflowStages: input.workflowStages.map((row, rowIndex) => rowIndex === index
          ? { ...row, choice: event.target.value as 'executed' | 'skipped' } : row),
      })}><option value="executed">실행</option><option value="skipped">생략</option></select></label>
      {stage.choice === 'skipped'
        ? <label>생략 이유<textarea value={stage.reason} readOnly={!canEdit} onChange={(event) => patch({
            workflowStages: input.workflowStages.map((row, rowIndex) => rowIndex === index
              ? { ...row, reason: event.target.value } : row),
          })} /></label>
        : <label>설계 문서 ref<textarea value={stage.designArtifactRefs} readOnly={!canEdit} onChange={(event) => patch({
            workflowStages: input.workflowStages.map((row, rowIndex) => rowIndex === index
              ? { ...row, designArtifactRefs: event.target.value } : row),
          })} /><small>artifactId@version을 한 줄에 하나씩 입력합니다.</small></label>}
      {canEdit && input.workflowStages.length > 1 && <button type="button" onClick={() => patch({
        workflowStages: input.workflowStages.filter((_, rowIndex) => rowIndex !== index),
      })}>단계 {index + 1} 삭제</button>}
    </fieldset>)}
    {canEdit && <button type="button" onClick={() => patch({
      workflowStages: [...input.workflowStages, {
        stageId: '', choice: 'skipped', reason: '', designArtifactRefs: '',
      }],
    })}>단계 추가</button>}
    {input.workflowTasks.map((task, index) => <fieldset key={index}>
      <legend>작업 {index + 1}</legend>
      <label>작업 ID<input value={task.taskId} readOnly={!canEdit} onChange={(event) => patch({
        workflowTasks: input.workflowTasks.map((row, rowIndex) => rowIndex === index
          ? { ...row, taskId: event.target.value } : row),
      })} /></label>
      <label>요구사항 ID<input value={task.requirementIds} readOnly={!canEdit} onChange={(event) => patch({
        workflowTasks: input.workflowTasks.map((row, rowIndex) => rowIndex === index
          ? { ...row, requirementIds: event.target.value } : row),
      })} /></label>
      <label>검증<textarea value={task.verification} readOnly={!canEdit} onChange={(event) => patch({
        workflowTasks: input.workflowTasks.map((row, rowIndex) => rowIndex === index
          ? { ...row, verification: event.target.value } : row),
      })} /></label>
      <label>순서<input type="number" min={1} value={task.order} readOnly={!canEdit} onChange={(event) => patch({
        workflowTasks: input.workflowTasks.map((row, rowIndex) => rowIndex === index
          ? { ...row, order: event.target.value } : row),
      })} /></label>
      {canEdit && input.workflowTasks.length > 1 && <button type="button" onClick={() => patch({
        workflowTasks: input.workflowTasks.filter((_, rowIndex) => rowIndex !== index),
      })}>작업 {index + 1} 삭제</button>}
    </fieldset>)}
    {canEdit && <button type="button" onClick={() => patch({
      workflowTasks: [...input.workflowTasks, {
        taskId: '', requirementIds: '', verification: '', order: String(input.workflowTasks.length + 1),
      }],
    })}>작업 추가</button>}
  </section>;
}

function ProposalFields({ input, patch, members, canEdit }: {
  readonly input: DraftFormInput;
  patch(value: Partial<DraftFormInput>): void;
  readonly members: readonly { readonly actorId: string; readonly displayName: string }[];
  readonly canEdit: boolean;
}) {
  if (input.body.kind === 'question_proposals') {
    const body = input.body;
    const updateProposal = (index: number, value: Partial<QuestionProposal>) => patch({
      body: {
        ...body,
        proposals: body.proposals.map((proposal, rowIndex) => rowIndex === index
          ? { ...proposal, ...value } : proposal) as unknown as typeof body.proposals,
      },
    });
    return <section className="draft-structure"><h4>질문 후보</h4>
      {body.proposals.map((proposal, index) => <fieldset key={proposal.temporaryId}>
        <legend><label><input type="checkbox" disabled={!canEdit}
          checked={input.selectedQuestionIds.includes(proposal.temporaryId)} onChange={(event) => patch({
            selectedQuestionIds: event.target.checked
              ? [...input.selectedQuestionIds, proposal.temporaryId]
              : input.selectedQuestionIds.filter((id) => id !== proposal.temporaryId),
          })} />질문 {proposal.temporaryId} 적용</label></legend>
        <label>질문 문구<textarea aria-label={`질문 ${proposal.temporaryId} 문구`} value={proposal.text} readOnly={!canEdit}
          onChange={(event) => updateProposal(index, { text: event.target.value })} /></label>
        <label>질문 이유<textarea aria-label={`질문 ${proposal.temporaryId} 이유`} value={proposal.reason} readOnly={!canEdit}
          onChange={(event) => updateProposal(index, { reason: event.target.value })} /></label>
        <label>제안 담당자<select aria-label={`질문 ${proposal.temporaryId} 제안 담당자`} value={proposal.suggestedAssigneeId}
          disabled={!canEdit} onChange={(event) => updateProposal(index, { suggestedAssigneeId: event.target.value })}>
          {members.map((member) => <option key={member.actorId} value={member.actorId}>{member.displayName}</option>)}
        </select></label>
        <label>필요 gate<select aria-label={`질문 ${proposal.temporaryId} 필요 gate`} value={proposal.requiredGate}
          disabled={!canEdit} onChange={(event) => updateProposal(index, { requiredGate: event.target.value as 'G1' | 'G2' })}>
          <option value="G1">G1</option><option value="G2">G2</option>
        </select></label>
        <label>답변 후보<textarea aria-label={`질문 ${proposal.temporaryId} 답변 후보`}
          value={proposal.candidateAnswers.join('\n')} readOnly={!canEdit}
          onChange={(event) => updateProposal(index, { candidateAnswers: splitLines(event.target.value) })} /></label>
        <p>출처 참조</p><ul>{proposal.sourceRefs.length === 0
          ? <li>없음</li>
          : proposal.sourceRefs.map((ref) => <li key={refLabel(ref)}>{refLabel(ref)}</li>)}</ul>
      </fieldset>)}
    </section>;
  }
  if (input.body.kind !== 'decision_proposals') return null;
  const body = input.body;
  const updateProposal = (index: number, value: Partial<DecisionProposal>) => patch({
    body: {
      ...body,
      proposals: body.proposals.map((proposal, rowIndex) => rowIndex === index
        ? { ...proposal, ...value } : proposal) as unknown as typeof body.proposals,
    },
  });
  return <section className="draft-structure"><h4>결정 후보</h4>
    {body.proposals.map((proposal: DecisionProposal, index) => {
      const selected = input.decisionSelections[index]!;
      const update = (value: Partial<DecisionSelectionForm>) => patch({
        decisionSelections: input.decisionSelections.map((row, rowIndex) => rowIndex === index
          ? { ...row, ...value } : row),
      });
      return <fieldset key={proposal.temporaryId}>
        <legend><label><input type="checkbox" checked={selected.selected} disabled={!canEdit}
          onChange={(event) => update({ selected: event.target.checked })} />결정 {proposal.temporaryId} 적용</label></legend>
        <label>결정 문구<textarea aria-label={`결정 ${proposal.temporaryId} 문구`} value={proposal.prompt} readOnly={!canEdit}
          onChange={(event) => updateProposal(index, { prompt: event.target.value })} /></label>
        <label>영향<textarea aria-label={`결정 ${proposal.temporaryId} 영향`} value={proposal.impact} readOnly={!canEdit}
          onChange={(event) => updateProposal(index, { impact: event.target.value })} /></label>
        <label>추천<input aria-label={`결정 ${proposal.temporaryId} 추천`} value={proposal.recommendation} readOnly={!canEdit}
          onChange={(event) => updateProposal(index, { recommendation: event.target.value })} /></label>
        {proposal.alternatives.map((alternative, alternativeIndex) => <fieldset key={alternativeIndex}>
          <legend>대안 {alternativeIndex + 1}</legend>
          <label>대안 ID<input aria-label={`결정 ${proposal.temporaryId} 대안 ${alternativeIndex + 1} ID`}
            value={alternative.optionId} readOnly={!canEdit} onChange={(event) => updateProposal(index, {
              alternatives: proposal.alternatives.map((row, rowIndex) => rowIndex === alternativeIndex
                ? { ...row, optionId: event.target.value } : row) as unknown as typeof proposal.alternatives,
            })} /></label>
          <label>대안 이름<input aria-label={`결정 ${proposal.temporaryId} 대안 ${alternativeIndex + 1} 이름`}
            value={alternative.label} readOnly={!canEdit} onChange={(event) => updateProposal(index, {
              alternatives: proposal.alternatives.map((row, rowIndex) => rowIndex === alternativeIndex
                ? { ...row, label: event.target.value } : row) as unknown as typeof proposal.alternatives,
            })} /></label>
          <label>대안 설명<textarea aria-label={`결정 ${proposal.temporaryId} 대안 ${alternativeIndex + 1} 설명`}
            value={alternative.description} readOnly={!canEdit} onChange={(event) => updateProposal(index, {
              alternatives: proposal.alternatives.map((row, rowIndex) => rowIndex === alternativeIndex
                ? { ...row, description: event.target.value } : row) as unknown as typeof proposal.alternatives,
            })} /></label>
          {canEdit && proposal.alternatives.length > 1 && <button type="button" onClick={() => updateProposal(index, {
            alternatives: proposal.alternatives.filter((_, rowIndex) => rowIndex !== alternativeIndex) as unknown as typeof proposal.alternatives,
          })}>대안 {alternativeIndex + 1} 삭제</button>}
        </fieldset>)}
        {canEdit && <button type="button" onClick={() => updateProposal(index, {
          alternatives: [...proposal.alternatives, {
            optionId: `option-${proposal.alternatives.length + 1}`, label: '', description: '',
          }],
        })}>대안 추가</button>}
        <p>출처 참조</p><ul>{proposal.sourceRefs.length === 0
          ? <li>없음</li>
          : proposal.sourceRefs.map((ref) => <li key={refLabel(ref)}>{refLabel(ref)}</li>)}</ul>
        <label>결정권자<select value={selected.decisionMakerId} disabled={!canEdit}
          onChange={(event) => update({ decisionMakerId: event.target.value })}>
          <option value="">선택</option>{members.map((member) => <option key={member.actorId} value={member.actorId}>{member.displayName}</option>)}
        </select></label>
        <label>분류<select aria-label="분류" value={selected.scope} disabled={!canEdit}
          onChange={(event) => update({ scope: event.target.value as 'current' | 'followup' })}>
          <option value="current">현재 필수</option><option value="followup">후속</option>
        </select></label>
        {selected.scope === 'current'
          ? <label>필요 gate<select value={selected.requiredGate} disabled={!canEdit}
              onChange={(event) => update({ requiredGate: event.target.value as 'G1' | 'G2' })}>
              <option value="G1">G1</option><option value="G2">G2</option>
            </select></label>
          : <><label>후속 담당자<select value={selected.followupOwnerId} disabled={!canEdit}
              onChange={(event) => update({ followupOwnerId: event.target.value })}>
              <option value="">선택</option>{members.map((member) => <option key={member.actorId} value={member.actorId}>{member.displayName}</option>)}
            </select></label><label>재검토 event<input value={selected.revisitEvent} readOnly={!canEdit}
              onChange={(event) => update({ revisitEvent: event.target.value })} /></label></>}
        <label>분류 이유<textarea value={selected.reason} readOnly={!canEdit}
          onChange={(event) => update({ reason: event.target.value })} /></label>
      </fieldset>;
    })}
  </section>;
}

export function DraftReview({ actorId, projectId, detail, members, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly members: readonly { readonly actorId: string; readonly displayName: string }[];
  onSaved(): void;
}) {
  const srId = detail.sr.scope.srId;
  const [selectedDraftId, setSelectedDraftId] = useState<string>();
  const [selectedDetail, setSelectedDetail] = useState<SRDetailView>();
  const [snapshot, setSnapshot] = useState<ReturnType<FormDraft<DraftFormInput, DraftFormBasis>['snapshot']>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [unknownReview, setUnknownReview] = useState<ReviewAttempt>();
  const [unknownApply, setUnknownApply] = useState<ApplyAttempt>();
  const sequenceRef = useRef(0);
  const draftRef = useRef<FormDraft<DraftFormInput, DraftFormBasis> | undefined>(undefined);
  const reviewSessionRef = useRef(new CommandSession());
  const applySessionRef = useRef(new CommandSession());
  const submittedReviewFormsRef = useRef(new Map<string, { readonly target: string; readonly editVersion: number }>());
  const editVersionRef = useRef({ target: '', version: 0 });
  const activeViewRef = useRef({ actorId, projectId, srId, selectedDraftId: undefined as string | undefined });
  if (activeViewRef.current.actorId !== actorId || activeViewRef.current.projectId !== projectId ||
    activeViewRef.current.srId !== srId) {
    activeViewRef.current = { actorId, projectId, srId, selectedDraftId: undefined };
  }

  useEffect(() => {
    setSelectedDraftId(undefined);
    setSelectedDetail(undefined);
    setSnapshot(undefined);
    draftRef.current = undefined;
    editVersionRef.current = { target: '', version: 0 };
    activeViewRef.current = { actorId, projectId, srId, selectedDraftId: undefined };
  }, [actorId, projectId, srId]);

  const sync = () => setSnapshot(draftRef.current?.snapshot());
  const loadDraft = async (draftId: string, options: {
    readonly preserveError?: boolean;
    readonly preserveFeedback?: boolean;
  } = {}) => {
    const sequence = ++sequenceRef.current;
    const changedSelection = activeViewRef.current.selectedDraftId !== draftId;
    activeViewRef.current = { actorId, projectId, srId, selectedDraftId: draftId };
    setLoading(true);
    if (changedSelection) {
      setUnknownReview(undefined);
      setUnknownApply(undefined);
      if (options.preserveFeedback !== true) setFeedback(undefined);
    }
    if (options.preserveError !== true) setError(undefined);
    try {
      const result = await invoke('M-047', { actorId, projectId, srId }, { kind: 'draft', draftId });
      if (sequence !== sequenceRef.current) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.value.draftReview === undefined) {
        setError('선택 초안 본문을 읽지 못했습니다.');
        return;
      }
      const input = inputFromDetail(result.value);
      const basis = { detail: result.value, draft: result.value.draftReview.draft };
      const identity = formIdentity(actorId, projectId, srId, draftId);
      if (draftRef.current?.snapshot().basis.draft.draftId === draftId) {
        draftRef.current.refreshFromServer(input, basis);
      } else {
        draftRef.current = new FormDraft(identity, input, basis);
        editVersionRef.current = { target: draftId, version: 0 };
      }
      setSelectedDraftId(draftId);
      setSelectedDetail(result.value);
      sync();
    } catch (caught) {
      if (sequence === sequenceRef.current) setError(caught instanceof Error ? caught.message : '초안을 읽지 못했습니다.');
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  };

  const patch = (value: Partial<DraftFormInput>) => {
    if (draftRef.current === undefined) return;
    draftRef.current.edit({ ...draftRef.current.snapshot().input, ...value });
    editVersionRef.current = {
      target: draftRef.current.snapshot().basis.draft.draftId,
      version: editVersionRef.current.version + 1,
    };
    sync();
    setError(undefined);
    setFeedback(undefined);
  };
  const canEdit = actorId === detail.sr.ownerId;
  const currentCommandContext = (command: 'M-018' | 'M-019') => {
    const current = activeViewRef.current;
    return {
      actorId: current.actorId,
      scope: { kind: 'sr' as const, projectId: current.projectId, srId: current.srId },
      target: current.selectedDraftId ?? '',
      command,
    };
  };
  const isCurrentAttempt = (attempt: ReviewAttempt | ApplyAttempt) => {
    const current = activeViewRef.current;
    return current.actorId === attempt.submission.actorId && current.projectId === attempt.submission.scope.projectId &&
      current.srId === ('srId' in attempt.submission.scope ? attempt.submission.scope.srId : undefined) &&
      current.selectedDraftId === attempt.submission.target;
  };

  const executeReview = async (attempt: ReviewAttempt) => {
    if (!reviewSessionRef.current.beginExecution(attempt)) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = asCommandResult(await invoke('M-019', {
        actorId, projectId, srId, idempotencyKey: attempt.idempotencyKey, guard: attempt.submission.guard,
      }, attempt.submission.input));
      const submittedForm = submittedReviewFormsRef.current.get(attempt.idempotencyKey);
      const resolution = reviewSessionRef.current.resolve(attempt, result, currentCommandContext('M-019'));
      submittedReviewFormsRef.current.delete(attempt.idempotencyKey);
      if (!resolution.appliesToCurrentForm) return;
      if (resolution.result.kind === 'rejected') {
        setError(resolution.result.error.message);
        if (resolution.result.error.code === 'INPUT_CHANGED') {
          void loadDraft(attempt.submission.target, { preserveError: true });
        }
        return;
      }
      setUnknownReview(undefined);
      const live = draftRef.current?.snapshot().input;
      if (live !== undefined && submittedForm !== undefined && submittedForm.target === attempt.submission.target &&
        editVersionRef.current.target === submittedForm.target &&
        editVersionRef.current.version === submittedForm.editVersion) {
        setFeedback('사람 검토 초안을 저장했습니다.');
        await loadDraft(resolution.result.value.draftId, { preserveFeedback: true });
      } else {
        setFeedback('검토한 초안을 저장했습니다. 현재 편집은 유지했습니다.');
      }
      onSaved();
    } catch (caught) {
      if (caught instanceof TransportUncertainError) {
        reviewSessionRef.current.endExecution(attempt);
        reviewSessionRef.current.markResultUnknown(attempt);
        if (isCurrentAttempt(attempt)) {
          setUnknownReview(attempt);
          setError('검토 초안 저장 결과를 확인할 수 없습니다. 같은 요청으로 확인하세요.');
        }
      } else {
        reviewSessionRef.current.endExecution(attempt);
        if (isCurrentAttempt(attempt)) {
          setError(caught instanceof Error ? caught.message : '검토 초안을 저장하지 못했습니다.');
        }
      }
    } finally {
      if (isCurrentAttempt(attempt)) setLoading(false);
    }
  };

  const saveReviewedDraft = () => {
    const current = draftRef.current?.snapshot();
    const preparation = current?.basis.detail.preparation;
    if (current === undefined || preparation?.kind !== 'draft') {
      setError('현재 입력 preparation이 없어 검토 초안을 저장할 수 없습니다.');
      return;
    }
    if (current.input.comparisonSummary.trim().length === 0) {
      setError('비교 검토 사유를 입력하세요.');
      return;
    }
    const input: ReviewedDraftInput = {
      sourceDraftId: current.basis.draft.draftId,
      currentInputFingerprint: preparation.currentInputFingerprint,
      body: current.input.body,
      comparisonSummary: current.input.comparisonSummary,
    };
    const guard = { expectedInputFingerprint: preparation.currentInputFingerprint };
    const attempt = reviewSessionRef.current.submit({
      actorId, scope: { kind: 'sr', projectId, srId }, target: current.basis.draft.draftId,
      command: 'M-019', input, guard,
    }) as ReviewAttempt;
    submittedReviewFormsRef.current.set(attempt.idempotencyKey, {
      target: current.basis.draft.draftId,
      editVersion: editVersionRef.current.version,
    });
    void executeReview(attempt);
  };

  const executeApply = async (attempt: ApplyAttempt) => {
    if (!applySessionRef.current.beginExecution(attempt)) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = asCommandResult(await invoke('M-018', {
        actorId, projectId, srId, idempotencyKey: attempt.idempotencyKey, guard: attempt.submission.guard,
      }, attempt.submission.input));
      const resolution = applySessionRef.current.resolve<AppliedDraftView, DraftApplication, DraftApplicationGuard>(
        attempt, result, currentCommandContext('M-018'),
      );
      if (!resolution.appliesToCurrentForm) return;
      if (resolution.result.kind === 'rejected') {
        setError(resolution.result.error.message);
        if (resolution.result.error.code === 'INPUT_CHANGED' || resolution.result.error.code === 'STALE_VERSION') {
          void loadDraft(attempt.submission.target, { preserveError: true });
        }
        return;
      }
      setUnknownApply(undefined);
      setFeedback('초안을 적용했습니다. 질문과 결정 제안은 적용 뒤에도 사람의 답변과 확정이 필요합니다.');
      onSaved();
      await loadDraft(attempt.submission.target);
    } catch (caught) {
      if (caught instanceof TransportUncertainError) {
        applySessionRef.current.endExecution(attempt);
        applySessionRef.current.markResultUnknown(attempt);
        if (isCurrentAttempt(attempt)) {
          setUnknownApply(attempt);
          setError('초안 적용 결과를 확인할 수 없습니다. 같은 요청으로 확인하세요.');
        }
      } else {
        applySessionRef.current.endExecution(attempt);
        if (isCurrentAttempt(attempt)) {
          setError(caught instanceof Error ? caught.message : '초안을 적용하지 못했습니다.');
        }
      }
    } finally {
      if (isCurrentAttempt(attempt)) setLoading(false);
    }
  };

  const applyDraft = () => {
    const current = draftRef.current?.snapshot();
    if (current === undefined) return;
    try {
      const input = buildApplication(current.basis.detail, current.input);
      const guard = applicationGuard(current.basis.detail, input);
      const attempt = applySessionRef.current.submit({
        actorId, scope: { kind: 'sr', projectId, srId }, target: current.basis.draft.draftId,
        command: 'M-018', input, guard,
      }) as ApplyAttempt;
      void executeApply(attempt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '초안 적용 입력을 만들지 못했습니다.');
    }
  };

  const selected = selectedDetail?.draftReview?.draft;
  const preparation = selectedDetail?.preparation?.kind === 'draft' ? selectedDetail.preparation : undefined;
  const applicationBlocked = selected?.application.kind === 'applied' || preparation?.freshness !== 'current';
  const inputComparison = selectedDetail?.draftReview === undefined
    ? []
    : compareInputContents(selectedDetail.draftReview.inputSnapshot.contents, selectedDetail, members);
  return <section className="draft-review" data-testid="draft-review">
    <header><p className="eyebrow">사람 검토</p><h2>생성 초안 검토</h2></header>
    {detail.generationDrafts.length === 0 ? <p className="empty-state">저장된 생성 초안이 없습니다.</p> : <ul className="draft-list">
      {detail.generationDrafts.map((draft, index) => <li key={draft.draftId}>
        <button type="button" aria-pressed={selectedDraftId === draft.draftId} onClick={() => { void loadDraft(draft.draftId); }}>
          제안 {index + 1} · {draft.provenance.kind === 'provider' ? 'AI 작성' : '사람 검토'} · {draft.application.kind === 'applied' ? '적용됨' : freshnessLabel(draft.freshness)}
        </button>
      </li>)}
    </ul>}
    {loading && <p role="status">초안 상태를 확인하고 있습니다.</p>}
    {error !== undefined && <div role="alert" className="command-error"><p>{error}</p>
      {unknownReview !== undefined && <button type="button" onClick={() => { void executeReview(reviewSessionRef.current.retry(unknownReview) as ReviewAttempt); }}>같은 검토 저장 결과 확인</button>}
      {unknownApply !== undefined && <button type="button" onClick={() => { void executeApply(applySessionRef.current.retry(unknownApply) as ApplyAttempt); }}>같은 적용 결과 확인</button>}
    </div>}
    {feedback !== undefined && <p role="status" className="command-feedback success">{feedback}</p>}
    {selected !== undefined && snapshot !== undefined && <article className="draft-card">
      <h3>{selected.body.kind === 'artifact' ? '문서 초안' : selected.body.kind === 'question_proposals' ? '확인할 질문' : '결정 제안'}</h3>
      <p>{provenanceLabel(selected.provenance)}</p>
      <p>{freshnessLabel(selected.freshness)} · {selected.application.kind === 'applied' ? '적용됨' : '미적용'}</p>
      {preparation !== undefined && <p>{preparation.freshness === 'current' ? '현재 자료를 기준으로 만든 제안입니다.' : '제안을 만든 뒤 자료가 바뀌었습니다. 변경 내용을 확인해 주세요.'}</p>}
      {preparation !== undefined && <details><summary>문서 버전 확인</summary><p>제안 작성 당시 {targetLabel(preparation.draftTargetBasis)} · 현재 {targetLabel(preparation.currentTargetBasis)}</p></details>}
      {selectedDetail?.preparationUnavailable !== undefined && <p className="quiet">현재 비교 준비 불가: {selectedDetail.preparationUnavailable.reason}</p>}
      <details><summary>고정 입력과 현재 참조</summary>
        <p>고정 입력 참조</p><ul>{selectedDetail!.draftReview!.inputSnapshot.contents.map((item, index) => <li key={`${refLabel(item.ref)}:${index}`}>{refLabel(item.ref)} · {item.confirmation}</li>)}</ul>
        <p>현재 참조</p><ul>{preparation?.basisRefs.map((ref) => <li key={refLabel(ref)}>{refLabel(ref)}</li>)}</ul>
      </details>
      <section className="draft-input-comparison" aria-label="고정 입력과 현재 자료 비교">
        <h4>고정 입력과 현재 자료 비교</h4>
        <p className="quiet">상태는 고정 생성 입력에 포함됐고 현재 조회에서도 확인 가능한 업무 필드를 기준으로 합니다.</p>
        {inputComparison.map((entry) => <article key={entry.key} className={`draft-input-diff state-${entry.state}`}>
          <header><strong>{entry.label}</strong><span>{entry.state}</span>
            {entry.before?.confirmation === 'unconfirmed' && <span>당시 미확인</span>}
          </header>
          <div><section><h5>고정 입력</h5><pre>{entry.before?.content ?? '당시 항목 없음'}</pre></section>
            <section><h5>현재 자료</h5><pre>{entry.current?.content ?? '현재 항목 없음'}</pre></section></div>
          {entry.note !== undefined && <p className="quiet">{entry.note}</p>}
        </article>)}
      </section>
      <ProposalFields input={snapshot.input} patch={patch} members={members} canEdit={canEdit} />
      <ArtifactFields input={snapshot.input} patch={patch} canEdit={canEdit} />
      <WorkflowFields input={snapshot.input} patch={patch} canEdit={canEdit} />
      {!canEdit && <p className="quiet">현재 SR owner만 검토 초안을 저장하거나 적용할 수 있습니다.</p>}
      {canEdit && <>
        <label>비교 검토 사유<textarea value={snapshot.input.comparisonSummary}
          onChange={(event) => patch({ comparisonSummary: event.target.value })} /></label>
        <button type="button" disabled={loading || preparation === undefined} onClick={saveReviewedDraft}>사람 검토 초안 저장</button>
        <label>초안 적용 이유<textarea value={snapshot.input.applicationReason}
          onChange={(event) => patch({ applicationReason: event.target.value })} /></label>
        {selected.application.kind !== 'applied' && <button className="primary-button" type="button"
          disabled={loading || applicationBlocked} onClick={applyDraft}>초안 적용</button>}
      </>}
      {snapshot.latestServer !== undefined && <div className="basis-comparison" role="status">
        <strong>새로운 초안 기준을 확인해 주세요.</strong>
        <p>{freshnessLabel(snapshot.latestServer.basis.draft.freshness)}</p>
        <button type="button" onClick={() => {
          draftRef.current?.adoptLatestBasis(formIdentity(actorId, projectId, srId, selected.draftId));
          editVersionRef.current = { target: selected.draftId, version: editVersionRef.current.version + 1 };
          sync(); setError(undefined);
        }}>최신 초안 기준으로 계속 작성</button>
      </div>}
      {canEdit && snapshot.dirty && <button type="button" onClick={() => {
        if (snapshot.latestServer !== undefined) {
          draftRef.current?.discardToLatest(formIdentity(actorId, projectId, srId, selected.draftId));
        } else {
          draftRef.current?.discard(inputFromDetail(snapshot.basis.detail), snapshot.basis);
        }
        editVersionRef.current = { target: selected.draftId, version: editVersionRef.current.version + 1 };
        sync(); setError(undefined);
      }}>작성 중 초안 폐기</button>}
    </article>}
  </section>;
}
