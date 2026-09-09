import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftApplicationGuard, RevisionGuard } from '@/src/contracts/context';
import type {
  DraftApplication,
  GenerationInput,
  GenerationRunView,
  NonEmpty,
  QuestionAnswer,
  QuestionProposal,
  QuestionView,
  SRDetailView,
} from '@/src/contracts/views';
import { deriveDraftDocumentStructure } from '../state/draft-document';
import { PLAN_VISUALIZATION_PROMPT } from '../state/plan-visualization-prompt';
import { invoke, TransportUncertainError } from '../api/client';
import './InceptionConversation.css';
import { SafeMarkdown } from './SafeMarkdown';

interface LoadedDraft {
  readonly detail: SRDetailView;
  readonly run: Extract<GenerationRunView, { readonly status: 'succeeded' }>;
  readonly presentation: 'questions' | 'explanation' | 'plan';
}

type WorkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working'; readonly message: string }
  | { readonly kind: 'ready'; readonly draft: LoadedDraft }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'uncertain'; readonly message: string; retry(): void };

interface AnswerDraft {
  readonly optionId: string;
  readonly text: string;
}

const INCEPTION_PLAN_PROMPT = `한 개의 requirements 문서로 Inception Plan 문서 보완안을 작성하세요.
현재 문서가 있으면 내용을 보존하고, 사용자의 설명과 답변으로 달라질 부분을 반영하세요.
첫 제목은 '# Inception Plan: 요청 제목'으로 씁니다.
다음 H2 제목을 정확히 사용하세요: '요구사항', '사용자 시나리오', '진행 계획', '주요 구조', '주요 결정', '작업 단위'.
각 H2 제목과 requirementRefs 값을 정확히 같게 만드세요.
사람이 답한 내용은 확인된 사실로, AI가 보완한 내용은 '미확인'으로 명시하세요.
목적과 범위, 사용자 시나리오, 주요 구조와 결정, 실제 작업 단위를 전체 맥락에서 정리하세요.
주요 구조에는 근거가 있는 관계만 '- 구성요소 A → 구성요소 B: 관계 설명' 형태로 한 줄씩 쓰세요. 모르는 관계를 만들지 말고 미확인으로 남기세요.
범위는 Inception과 작업 단위까지입니다. 기능·NFR·인프라 상세 설계나 구현 코드는 만들지 마세요.
사용자의 답이나 승인 없이 결론이 확정된 것처럼 쓰지 마세요.

${PLAN_VISUALIZATION_PROMPT}`;

function nonEmpty<T>(items: readonly T[]): NonEmpty<T> | undefined {
  const [first, ...rest] = items;
  return first === undefined ? undefined : [first, ...rest];
}

function contextKey(actorId: string, projectId: string, srId: string): string {
  return `${actorId}:${projectId}:${srId}`;
}

function generationFailure(run: GenerationRunView): string {
  if (run.status === 'failed') return `AI가 내용을 정리하지 못했습니다. ${run.error.diagnostic}`;
  if (run.status === 'cancelled') return 'AI 정리가 취소됐습니다.';
  return 'AI 정리가 끝나지 않았습니다.';
}

async function generationReady(): Promise<boolean> {
  const response = await fetch('/health/ready');
  const body = await response.json() as unknown;
  return response.ok && typeof body === 'object' && body !== null &&
    'generationReady' in body && body.generationReady === true;
}

function questionSupplement(detail: SRDetailView, supplement: string): string | undefined {
  const answered = detail.questions.flatMap((question) => {
    const answer = question.currentResult.selectedAnswer?.answer.text;
    return answer === undefined ? [] : [`질문: ${question.text}\n사람의 답변: ${answer}`];
  });
  const blocks = [
    supplement.trim() === '' ? undefined : `사용자가 추가로 설명한 내용:\n${supplement.trim()}`,
    answered.length === 0 ? undefined : `지금까지 사람이 답한 내용:\n${answered.join('\n\n')}`,
    '쉬운 업무 언어로 꼭 필요한 확인 질문만 제안하세요. 질문 이유에는 답에 따라 무엇이 달라지는지 설명하세요.',
    `각 질문 제안의 suggestedAssigneeId는 SR 담당자인 '${detail.sr.ownerId}'로, requiredGate는 'G1'으로 지정하세요.`,
    '재질문은 현재 Inception의 목적, 범위, 사용자 시나리오, 주요 결정과 작업 단위를 확정하는 데 필요한 내용으로 한정하세요.',
  ].filter((item): item is string => item !== undefined);
  return blocks.length === 0 ? undefined : blocks.join('\n\n');
}

function explanationSupplement(proposal: QuestionProposal, supplement: string): string {
  return [
    supplement.trim() === '' ? undefined : `사용자가 추가로 설명한 내용:\n${supplement.trim()}`,
    `선택한 질문: ${proposal.text}`,
    `이 질문이 필요한 이유와 선택의 영향: ${proposal.reason}`,
    proposal.candidateAnswers.length === 0 ? undefined : `답변 후보: ${proposal.candidateAnswers.join(' / ')}`,
    '이 질문을 전문 용어 없이 더 쉽게 풀어 설명하고, 사용자가 답하기 좋은 후속 질문으로 제안하세요.',
    '현재 Inception 범위 밖의 상세 설계나 구현 질문으로 넓히지 마세요.',
  ].filter((item): item is string => item !== undefined).join('\n\n');
}

function planInput(detail: SRDetailView, supplement: string): GenerationInput {
  const current = detail.artifacts.find((artifact) => artifact.kind === 'requirements');
  const prompt = [INCEPTION_PLAN_PROMPT, supplement.trim() === '' ? undefined : `사용자의 추가 설명:\n${supplement.trim()}`]
    .filter((item): item is string => item !== undefined).join('\n\n');
  return current === undefined
    ? { taskKind: 'ARTIFACT_DRAFT', documentKind: 'requirements', targetBasis: { kind: 'absent', logicalKey: 'requirements' }, supplement: prompt }
    : { taskKind: 'ARTIFACT_REVISION', documentKind: 'requirements', targetBasis: { kind: 'version', ref: current.versionRef }, supplement: prompt };
}

function questionsInput(supplement: string | undefined): GenerationInput {
  return supplement === undefined
    ? { taskKind: 'QUESTION_PROPOSALS' }
    : { taskKind: 'QUESTION_PROPOSALS', supplement };
}

function answerDraft(question: QuestionView): AnswerDraft {
  return { optionId: question.options[0]?.optionId ?? '', text: '' };
}

export function InceptionConversation({ actorId, projectId, detail, actorName, onSaved, onOpenDocument }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly actorName?: (actorId: string) => string;
  onSaved(): void;
  onOpenDocument?(): void;
}) {
  const srId = detail.sr.scope.srId;
  const owner = actorId === detail.sr.ownerId;
  const scope = useMemo(() => ({ actorId, projectId, srId }), [actorId, projectId, srId]);
  const activeContext = useRef(contextKey(actorId, projectId, srId));
  const sequence = useRef(0);
  const [supplement, setSupplement] = useState('');
  const [work, setWork] = useState<WorkState>({ kind: 'idle' });
  const [selectedProposalIds, setSelectedProposalIds] = useState<readonly string[]>([]);
  const [answers, setAnswers] = useState<Readonly<Record<string, AnswerDraft>>>({});
  const [commandMessage, setCommandMessage] = useState<string>();
  const [commandError, setCommandError] = useState<string>();
  const [commandRetry, setCommandRetry] = useState<(() => void) | undefined>();
  const [commandBusy, setCommandBusy] = useState(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    activeContext.current = contextKey(actorId, projectId, srId);
    sequence.current += 1;
    setSupplement('');
    setWork({ kind: 'idle' });
    setSelectedProposalIds([]);
    setAnswers({});
    setCommandMessage(undefined);
    setCommandError(undefined);
    setCommandRetry(undefined);
  }, [actorId, projectId, srId]);

  const accepts = (key: string, requestSequence: number): boolean =>
    activeContext.current === key && sequence.current === requestSequence;

  const loadDraft = async (
    run: Extract<GenerationRunView, { readonly status: 'succeeded' }>,
    key: string,
    requestSequence: number,
    presentation: LoadedDraft['presentation'],
  ) => {
    const loaded = await invoke('M-047', scope, { kind: 'draft', draftId: run.draft.draftId });
    if (!accepts(key, requestSequence)) return;
    if (!loaded.ok || loaded.value.draftReview === undefined || loaded.value.preparation?.kind !== 'draft') {
      setWork({ kind: 'error', message: loaded.ok ? '생성된 보완안을 다시 읽지 못했습니다.' : loaded.error.message });
      return;
    }
    setSelectedProposalIds([]);
    setWork({ kind: 'ready', draft: { detail: loaded.value, run, presentation } });
    onSaved();
  };

  const poll = async (
    run: GenerationRunView,
    key: string,
    requestSequence: number,
    presentation: LoadedDraft['presentation'],
  ) => {
    let current = run;
    for (let attempt = 0; attempt < 1_300; attempt += 1) {
      if (!accepts(key, requestSequence)) return;
      if (current.status === 'succeeded') {
        await loadDraft(current, key, requestSequence, presentation);
        return;
      }
      if (current.status === 'failed' || current.status === 'cancelled') {
        setWork({ kind: 'error', message: generationFailure(current) });
        onSaved();
        return;
      }
      setWork({ kind: 'working', message: current.status === 'pending' ? 'AI 작업이 실행을 기다리고 있습니다.' : 'AI가 저장된 내용을 정리하고 있습니다.' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const read = await invoke('M-033', scope, current.runId);
      if (!accepts(key, requestSequence)) return;
      if (!read.ok) {
        setWork({ kind: 'error', message: read.error.message });
        return;
      }
      current = read.value;
    }
    if (accepts(key, requestSequence)) setWork({ kind: 'error', message: 'AI 작업이 계속 진행 중입니다. 잠시 뒤 다시 확인하세요.' });
  };

  const generate = async (
    input: GenerationInput,
    presentation: LoadedDraft['presentation'],
    idempotencyKey = crypto.randomUUID(),
  ) => {
    const key = contextKey(actorId, projectId, srId);
    const requestSequence = ++sequence.current;
    setWork({ kind: 'working', message: 'AI 생성 준비 상태를 확인하고 있습니다.' });
    try {
      if (!(await generationReady())) {
        if (accepts(key, requestSequence)) setWork({ kind: 'error', message: 'AI 생성이 준비되지 않았습니다. 추가 설명과 Plan 문서는 직접 작성할 수 있습니다.' });
        return;
      }
      if (!accepts(key, requestSequence)) return;
      setWork({ kind: 'working', message: '현재 설명과 답변을 생성 입력으로 고정하고 있습니다.' });
      const prepared = await invoke('M-047', scope, { kind: 'new_generation', input });
      if (!accepts(key, requestSequence)) return;
      if (!prepared.ok || prepared.value.preparation?.kind !== 'new_generation') {
        setWork({ kind: 'error', message: prepared.ok ? '현재 자료로 AI 입력을 준비하지 못했습니다.' : prepared.error.message });
        return;
      }
      const requested = await invoke('M-032', {
        ...scope,
        idempotencyKey,
        guard: { expectedInputFingerprint: prepared.value.preparation.expectedInputFingerprint },
      }, input);
      if (!accepts(key, requestSequence)) return;
      if (!requested.ok) {
        setWork({ kind: 'error', message: requested.error.message });
        return;
      }
      await poll(requested.value, key, requestSequence, presentation);
    } catch (error) {
      if (!accepts(key, requestSequence)) return;
      setWork(error instanceof TransportUncertainError
        ? {
            kind: 'uncertain',
            message: 'AI 요청 결과를 확인할 수 없습니다. 같은 요청으로 저장 결과를 확인합니다.',
            retry: () => { void generate(input, presentation, idempotencyKey); },
          }
        : { kind: 'error', message: 'AI 생성 연결을 사용할 수 없습니다. 직접 Plan을 작성할 수 있습니다.' });
    }
  };

  const runCommand = async (key: string, action: () => Promise<void>) => {
    const expectedContext = contextKey(actorId, projectId, srId);
    setCommandBusy(true);
    setCommandError(undefined);
    setCommandMessage(undefined);
    setCommandRetry(undefined);
    try {
      await action();
    } catch (error) {
      if (activeContext.current !== expectedContext) return;
      if (error instanceof TransportUncertainError) {
        setCommandError('저장 결과를 확인할 수 없습니다. 같은 요청으로 결과를 다시 확인하세요.');
        setCommandRetry(() => () => { void runCommand(key, action); });
      } else {
        setCommandError(error instanceof Error ? error.message : '내용을 저장하지 못했습니다.');
      }
    } finally {
      if (activeContext.current === expectedContext) setCommandBusy(false);
    }
  };

  const applyQuestions = () => {
    if (work.kind !== 'ready' || work.draft.run.draft.body.kind !== 'question_proposals') return;
    const ids = nonEmpty(selectedProposalIds);
    if (ids === undefined) {
      setCommandError('추가할 참고 질문을 하나 이상 선택하세요.');
      return;
    }
    const prepared = work.draft.detail.preparation;
    if (prepared?.kind !== 'draft' || prepared.freshness !== 'current') {
      setCommandError('저장된 내용이 바뀌었습니다. 현재 내용으로 참고 질문을 다시 제안받으세요.');
      return;
    }
    const input: DraftApplication = {
      draftId: work.draft.run.draft.draftId,
      applicationReason: '사람이 선택한 참고 질문을 문서 보완 과정에 추가합니다.',
      selectedContent: { kind: 'questions', temporaryIds: ids },
    };
    const guard: DraftApplicationGuard = { kind: 'questions', expectedInputFingerprint: prepared.currentInputFingerprint };
    const idempotencyKey = crypto.randomUUID();
    void runCommand(idempotencyKey, async () => {
      const result = await invoke('M-018', { ...scope, idempotencyKey, guard }, input);
      if (!result.ok) {
        if (result.error.code === 'INPUT_CHANGED' || result.error.code === 'STALE_VERSION') onSaved();
        throw new Error(result.error.message);
      }
      setCommandMessage('선택한 참고 질문을 저장했습니다. 담당자가 답하면 다음 문서 보완안에 참고할 수 있습니다.');
      setSelectedProposalIds([]);
      onSaved();
    });
  };

  const applyPlan = () => {
    if (work.kind !== 'ready' || work.draft.run.draft.body.kind !== 'artifact') return;
    const draft = work.draft.run.draft;
    const body = draft.body;
    if (body.kind !== 'artifact') return;
    const prepared = work.draft.detail.preparation;
    if (body.documentKind !== 'requirements' || prepared?.kind !== 'draft' ||
      prepared.freshness !== 'current' || prepared.currentTargetBasis === undefined) {
      setCommandError('현재 Plan 기준이 바뀌었습니다. 최신 내용으로 문서 보완안을 다시 만드세요.');
      return;
    }
    const structure = deriveDraftDocumentStructure(body.markdown);
    const generatedRefs = [...body.requirementRefs].sort();
    const derivedRefs = structure.requirementLinks.map((item) => item.requirementId).sort();
    if (structure.sectionIndex.length === 0 || JSON.stringify(generatedRefs) !== JSON.stringify(derivedRefs)) {
      setCommandError('AI 문서 보완안의 구분을 자동으로 확인하지 못했습니다. Plan 문서에서 내용을 검토해 직접 반영하세요.');
      return;
    }
    const targetBasis = prepared.currentTargetBasis;
    const current = targetBasis.kind === 'version'
      ? work.draft.detail.artifacts.find((artifact) => artifact.artifactId === targetBasis.ref.entityId)
      : undefined;
    if (targetBasis.kind === 'version' && current === undefined) {
      setCommandError('현재 Plan version을 찾지 못했습니다. 상세를 새로 읽으세요.');
      return;
    }
    const fixedDetail = work.draft.detail;
    const decisionRefs = fixedDetail.decisions.flatMap((decision) =>
      decision.currentConfirmation === undefined ? [] : [decision.currentConfirmation.ref]);
    const sourceRefs = fixedDetail.sources.flatMap((source) =>
      source.confirmation === 'confirmed' ? [source.currentVersionRef] : []);
    const questionResultRefs = fixedDetail.questions.flatMap((question) =>
      question.currentResult.selectedAnswer === undefined ? [] : [question.currentResult.ref]);
    const input: DraftApplication = {
      draftId: draft.draftId,
      applicationReason: '사람이 AI 문서 보완안을 현재 Inception Plan과 비교하고 선택해 반영합니다.',
      selectedContent: { kind: 'artifact', edit: {
        ...(targetBasis.kind === 'version' ? { artifactId: targetBasis.ref.entityId } : {}),
        kind: 'requirements',
        markdown: body.markdown,
        sectionIndex: structure.sectionIndex,
        requirementLinks: structure.requirementLinks.map((link) => ({
          ...link,
          acceptanceCriteria: [`${link.requirementId} 내용을 사람이 읽고 현재 Inception Plan에 포함할지 확인합니다.`],
        })),
        changeSummary: body.changeSummary,
        targetBasis,
        decisionRefs,
        sourceRefs,
        questionResultRefs,
      } },
    };
    const target = targetBasis.kind === 'absent'
      ? { target: { kind: 'artifact_logical_key' as const, projectId, srId, logicalKey: targetBasis.logicalKey }, expected: 'absent' as const }
      : { target: { kind: 'artifact' as const, projectId, srId, entityId: targetBasis.ref.entityId }, expectedRevision: current!.revision };
    const guard: DraftApplicationGuard = { kind: 'artifact', expectedInputFingerprint: prepared.currentInputFingerprint, target };
    const idempotencyKey = crypto.randomUUID();
    void runCommand(idempotencyKey, async () => {
      const result = await invoke('M-018', { ...scope, idempotencyKey, guard }, input);
      if (!result.ok) {
        if (result.error.code === 'INPUT_CHANGED' || result.error.code === 'STALE_VERSION') onSaved();
        throw new Error(result.error.message);
      }
      setCommandMessage('선택한 문서 보완안을 Plan에 반영했습니다. 이제 동료와 함께 문서를 검토할 수 있습니다.');
      onSaved();
      onOpenDocument?.();
    });
  };

  const saveAnswer = (question: QuestionView) => {
    const value = answers[question.questionId] ?? answerDraft(question);
    const submittedDraft = value;
    const selected = question.options.find((option) => option.optionId === value.optionId);
    const answer = question.answerMode === 'choice' && selected !== undefined
      ? { kind: 'choice' as const, optionId: selected.optionId, text: selected.text }
      : { kind: 'free_text' as const, text: value.text.trim() };
    if (answer.text === '') {
      setCommandError('질문에 답을 입력하세요.');
      return;
    }
    const input: QuestionAnswer = {
      questionId: question.questionId,
      answeredQuestionSnapshotRef: question.currentResult.ref,
      answer,
      evidence: { text: answer.text },
    };
    const guard: RevisionGuard<'question'> = { resource: {
      target: { kind: 'question', projectId, srId, entityId: question.questionId },
      expectedRevision: question.revision,
    } };
    const idempotencyKey = crypto.randomUUID();
    void runCommand(idempotencyKey, async () => {
      const result = await invoke('M-008', { ...scope, idempotencyKey, guard }, input);
      if (!result.ok) {
        if (result.error.code === 'STALE_VERSION') onSaved();
        throw new Error(result.error.message);
      }
      const liveChanged = JSON.stringify(answersRef.current[question.questionId] ?? answerDraft(question)) !==
        JSON.stringify(submittedDraft);
      if (!liveChanged) {
        setAnswers((currentAnswers) => {
          const next = { ...currentAnswers };
          delete next[question.questionId];
          return next;
        });
      }
      setCommandMessage(liveChanged
        ? '이전에 제출한 답변을 저장했습니다. 새로 작성 중인 답변은 유지했습니다.'
        : '답변을 저장했습니다. 다음 AI 문서 보완안에서 참고할 수 있습니다.');
      onSaved();
    });
  };

  const updateAnswer = (question: QuestionView, patch: Partial<AnswerDraft>) => {
    setAnswers((current) => ({
      ...current,
      [question.questionId]: { ...(current[question.questionId] ?? answerDraft(question)), ...patch },
    }));
    setCommandError(undefined);
  };

  const generated = work.kind === 'ready' ? work.draft.run.draft.body : undefined;
  const existingRun = detail.generationRuns.find((run) => run.status === 'pending' || run.status === 'running');
  const hasAnswers = detail.questions.some((question) => question.currentResult.selectedAnswer !== undefined);
  const generationBusy = work.kind === 'working' || work.kind === 'uncertain';
  const displayActor = (id: string) => actorName?.(id) ?? (id === detail.sr.ownerId ? 'SR 담당자' : '지정된 담당자');

  return <section className="inception-conversation" data-testid="inception-conversation">
    <header><div><p className="eyebrow">선택형 AI 보조</p><h2>AI로 문서 보완</h2></div><span>{owner ? '담당자' : '참여자'}</span></header>
    <p className="inception-conversation__intro">현재 Plan 문서를 기준으로 참고 질문이나 문서 보완안을 선택해 사용합니다. AI 제안은 사용자가 선택해 반영하기 전까지 문서나 결재 상태를 바꾸지 않습니다.</p>

    {owner && <div className="inception-conversation__composer">
      <label>문서 보완에 더 알려줄 내용<textarea rows={5} value={supplement} placeholder="목적, 사용자, 꼭 포함할 범위, 피해야 할 방식 등을 자연스럽게 적으세요." onChange={(event) => setSupplement(event.target.value)} /></label>
      <div className="inception-conversation__actions">
        <button className="primary-button" type="button" disabled={generationBusy} onClick={() => void generate(questionsInput(questionSupplement(detail, supplement)), 'questions')}>참고 질문 제안받기</button>
        {hasAnswers && <button type="button" disabled={generationBusy} onClick={() => void generate(questionsInput(questionSupplement(detail, supplement)), 'questions')}>답변을 바탕으로 참고 질문 더 받기</button>}
        <button type="button" disabled={generationBusy} onClick={() => void generate(planInput(detail, supplement), 'plan')}>문서 보완안 만들기</button>
      </div>
      <p className="quiet">AI는 현재 문서의 목적·범위·시나리오·결정·작업 단위를 보완하는 선택지로만 사용합니다.</p>
    </div>}
    {!owner && <p className="inception-conversation__notice">SR 담당자가 AI 보완안을 선택해 문서에 반영합니다. 내게 배정된 참고 질문에는 아래에서 직접 답할 수 있습니다.</p>}

    {work.kind === 'working' && <p className="inception-conversation__status" role="status">{work.message}</p>}
    {work.kind === 'error' && <div className="inception-conversation__error" role="alert"><p>{work.message}</p>{onOpenDocument && <button type="button" onClick={onOpenDocument}>Plan 직접 작성</button>}</div>}
    {work.kind === 'uncertain' && <div className="inception-conversation__error" role="alert"><p>{work.message}</p><button type="button" onClick={work.retry}>생성 이력 새로고침</button></div>}
    {work.kind === 'idle' && existingRun !== undefined && <p className="inception-conversation__status" role="status">{existingRun.status === 'pending' ? '기존 AI 작업이 실행을 기다리고 있습니다.' : '기존 AI 작업이 진행 중입니다.'}</p>}

    {generated?.kind === 'question_proposals' && <section className="inception-conversation__proposals">
      <h3>{work.kind === 'ready' && work.draft.presentation === 'explanation' ? '이 질문을 더 쉽게 풀어 쓴 제안' : 'AI가 제안한 참고 질문'}</h3>
      <p>{work.kind === 'ready' && work.draft.presentation === 'explanation'
        ? '기존 질문은 그대로 유지됩니다. 아래 내용은 설명을 돕기 위한 제안이며 새 질문으로 추가되지 않습니다.'
        : '추가할 참고 질문만 선택하세요. 선택 전에는 질문이나 답변으로 확정되지 않습니다.'}</p>
      {generated.proposals.map((proposal) => <article key={proposal.temporaryId}>
        {work.kind === 'ready' && work.draft.presentation === 'explanation' ? <strong>{proposal.text}</strong> : <label className="inception-conversation__select"><input type="checkbox" checked={selectedProposalIds.includes(proposal.temporaryId)} onChange={(event) => setSelectedProposalIds((current) => event.target.checked ? [...current, proposal.temporaryId] : current.filter((id) => id !== proposal.temporaryId))} /><strong>{proposal.text}</strong></label>}
        <p><b>왜 묻나요 · 선택에 따른 영향</b><br />{proposal.reason}</p>
        <p className="quiet">참고 질문 · 답변 담당자 {displayActor(proposal.suggestedAssigneeId)}</p>
        {proposal.candidateAnswers.length > 0 && <div><b>답변을 생각할 때 참고할 후보</b><ul>{proposal.candidateAnswers.map((answer) => <li key={answer}>{answer}</li>)}</ul></div>}
        {work.kind === 'ready' && work.draft.presentation !== 'explanation' && <button className="text-button" type="button" onClick={() => void generate(questionsInput(explanationSupplement(proposal, supplement)), 'explanation')}>이 참고 질문을 쉽게 풀어 보기</button>}
      </article>)}
      {owner && work.kind === 'ready' && work.draft.presentation !== 'explanation' && <button className="primary-button" type="button" disabled={commandBusy} onClick={applyQuestions}>선택한 참고 질문 추가</button>}
    </section>}

    {generated?.kind === 'artifact' && generated.documentKind === 'requirements' && <section className="inception-conversation__plan">
      <h3>AI 문서 보완안</h3><p>현재 Plan과 비교한 뒤 이 보완안을 반영할지 선택하세요. 확인되지 않은 내용은 원문에서 다시 확인합니다.</p>
      <div className="inception-conversation__plan-preview"><SafeMarkdown>{generated.markdown}</SafeMarkdown></div>
      {owner && <div className="inception-conversation__actions"><button className="primary-button" type="button" disabled={commandBusy} onClick={applyPlan}>이 문서 보완안 반영</button>{onOpenDocument && <button type="button" onClick={onOpenDocument}>현재 Plan 열어 비교</button>}</div>}
    </section>}

    <section className="inception-conversation__history">
      <h3>문서 보완에 참고한 질문과 답변</h3>
      {detail.questions.length === 0 ? <p className="quiet">저장된 참고 질문이 없습니다.</p> : detail.questions.map((question) => {
        const answer = question.currentResult.selectedAnswer;
        const draft = answers[question.questionId] ?? answerDraft(question);
        const canAnswer = question.status === 'open' && question.assigneeId === actorId;
        return <article key={question.questionId} id={`inception-question-${question.questionId}`} data-testid={`inception-question-${question.questionId}`} tabIndex={-1}>
          <h4>{question.text}</h4><p className="quiet">{question.reason}</p>
          <p className="quiet">답변 담당자 · {displayActor(question.assigneeId)} · 상태 {question.status === 'open' ? '답변 대기' : question.status === 'answered' ? '답변 저장됨' : question.status === 'resolved' ? '기존 확인 완료' : '결정으로 전환됨'}</p>
          {question.candidateAnswers.length > 0 && <p><b>답변을 위한 선택지</b> · {question.candidateAnswers.join(' / ')}</p>}
          {answer !== undefined && <blockquote><b>저장된 답변</b><br />{answer.answer.text}</blockquote>}
          {canAnswer && <div className="inception-conversation__answer">
            {question.answerMode === 'choice' ? <fieldset><legend>답변 선택</legend>{question.options.map((option) => <label key={option.optionId}><input type="radio" name={`inception-answer-${question.questionId}`} checked={draft.optionId === option.optionId} onChange={() => updateAnswer(question, { optionId: option.optionId })} />{option.text}</label>)}</fieldset> : <label>내 답변<textarea rows={3} value={draft.text} onChange={(event) => updateAnswer(question, { text: event.target.value })} /></label>}
            <button type="button" disabled={commandBusy} onClick={() => saveAnswer(question)}>답변 저장</button>
          </div>}
          {question.status === 'open' && !canAnswer && <p className="inception-conversation__notice">{displayActor(question.assigneeId)}님의 답변을 기다립니다.</p>}
        </article>;
      })}
    </section>

    {commandError && <div className="inception-conversation__error" role="alert"><p>{commandError}</p>{commandRetry && <button type="button" onClick={commandRetry}>같은 요청 결과 확인</button>}</div>}
    {commandMessage && <p className="inception-conversation__success" role="status">{commandMessage}</p>}
  </section>;
}
