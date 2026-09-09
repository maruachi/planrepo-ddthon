import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DocumentKind,
  GenerationInput,
  GenerationRunView,
  SRDetailView,
} from '@/src/contracts/views';
import { invoke, TransportUncertainError } from '../api/client';
import './GenerationAssistant.css';

type AssistantAction = 'questions' | 'document';
type AssistantState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' | 'preparing' | 'requesting' }
  | { readonly kind: 'waiting'; readonly run: GenerationRunView }
  | { readonly kind: 'completed'; readonly run: Extract<GenerationRunView, { readonly status: 'succeeded' }> }
  | { readonly kind: 'failed'; readonly message: string; readonly run?: GenerationRunView }
  | { readonly kind: 'uncertain'; readonly message: string };

function manualGuidance(action: AssistantAction): string {
  return action === 'questions'
    ? 'AI 없이도 요구사항 문서에 확인할 내용을 작성할 수 있습니다.'
    : '문서 탭에서 요구사항이나 진행 계획을 직접 작성해 저장할 수 있습니다.';
}

function documentInput(detail: SRDetailView, documentKind: DocumentKind): GenerationInput {
  const current = detail.artifacts.find((artifact) => artifact.kind === documentKind);
  return current === undefined
    ? {
        taskKind: 'ARTIFACT_DRAFT',
        documentKind,
        targetBasis: { kind: 'absent', logicalKey: documentKind },
      }
    : {
        taskKind: 'ARTIFACT_REVISION',
        documentKind,
        targetBasis: { kind: 'version', ref: current.versionRef },
      };
}

async function generationReady(): Promise<boolean> {
  const response = await fetch('/health/ready', { method: 'GET' });
  const body = await response.json() as unknown;
  return response.ok && typeof body === 'object' && body !== null &&
    'generationReady' in body && body.generationReady === true;
}

function failureMessage(run: GenerationRunView): string {
  if (run.status === 'failed') return `AI 정리가 완료되지 않았습니다. ${run.error.diagnostic}`;
  if (run.status === 'cancelled') return 'AI 정리가 취소됐습니다.';
  return 'AI 정리가 완료되지 않았습니다.';
}

export function GenerationAssistant({
  actorId,
  projectId,
  detail,
  onSaved,
  onReviewDraft,
  defaultDocumentKind,
}: {
  readonly defaultDocumentKind?: 'requirements' | 'workflow_plan';
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  onSaved(): void;
  onReviewDraft?(): void;
}) {
  const srId = detail.sr.scope.srId;
  const planning = defaultDocumentKind === 'workflow_plan';
  const documentKind: 'requirements' | 'workflow_plan' = planning ? 'workflow_plan' : 'requirements';
  const [action, setAction] = useState<AssistantAction>(planning ? 'document' : 'questions');
  const [state, setState] = useState<AssistantState>({ kind: 'idle' });
  const sequence = useRef(0);
  const mounted = useRef(true);
  const owner = actorId === detail.sr.ownerId;
  const working = ['checking', 'preparing', 'requesting', 'waiting'].includes(state.kind);
  const existingActiveRun = detail.generationRuns.find((run) => run.status === 'pending' || run.status === 'running');
  const scope = useMemo(() => ({ actorId, projectId, srId }), [actorId, projectId, srId]);

  useEffect(() => {
    mounted.current = true;
    const currentSequence = ++sequence.current;
    setState({ kind: 'idle' });
    return () => {
      mounted.current = false;
      if (sequence.current === currentSequence) sequence.current += 1;
    };
  }, [actorId, projectId, srId]);

  const accept = (requestSequence: number) => mounted.current && sequence.current === requestSequence;

  const poll = async (run: GenerationRunView, requestSequence: number) => {
    let current = run;
    for (let attempt = 0; attempt < 1_300; attempt += 1) {
      if (!accept(requestSequence)) return;
      if (current.status === 'succeeded') {
        setState({ kind: 'completed', run: current });
        onSaved();
        onReviewDraft?.();
        return;
      }
      if (current.status === 'failed' || current.status === 'cancelled') {
        setState({ kind: 'failed', message: failureMessage(current), run: current });
        onSaved();
        return;
      }
      setState({ kind: 'waiting', run: current });
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      const read = await invoke('M-033', scope, current.runId);
      if (!accept(requestSequence)) return;
      if (!read.ok) {
        setState({ kind: 'failed', message: read.error.message });
        return;
      }
      current = read.value;
    }
    if (accept(requestSequence)) {
      setState({ kind: 'failed', message: 'AI 작업이 계속 실행 중입니다. 잠시 뒤 상태를 다시 확인해 주세요.', run: current });
    }
  };

  const start = async () => {
    const requestSequence = ++sequence.current;
    const input: GenerationInput = action === 'questions'
      ? { taskKind: 'QUESTION_PROPOSALS' }
      : documentInput(detail, documentKind);
    setState({ kind: 'checking' });
    try {
      if (!(await generationReady())) {
        if (accept(requestSequence)) {
          setState({
            kind: 'failed',
            message: `AI 생성이 현재 준비되지 않았습니다. ${manualGuidance(action)}`,
          });
        }
        return;
      }
      if (!accept(requestSequence)) return;
      setState({ kind: 'preparing' });
      const prepared = await invoke('M-047', scope, { kind: 'new_generation', input });
      if (!accept(requestSequence)) return;
      if (!prepared.ok) {
        setState({ kind: 'failed', message: `${prepared.error.message} ${manualGuidance(action)}` });
        return;
      }
      if (prepared.value.preparation?.kind !== 'new_generation') {
        setState({ kind: 'failed', message: `AI 입력을 준비하지 못했습니다. ${manualGuidance(action)}` });
        return;
      }
      setState({ kind: 'requesting' });
      const requested = await invoke('M-032', {
        ...scope,
        guard: { expectedInputFingerprint: prepared.value.preparation.expectedInputFingerprint },
      }, input);
      if (!accept(requestSequence)) return;
      if (!requested.ok) {
        setState({ kind: 'failed', message: `${requested.error.message} ${manualGuidance(action)}` });
        return;
      }
      await poll(requested.value, requestSequence);
    } catch (error) {
      if (!accept(requestSequence)) return;
      setState(error instanceof TransportUncertainError
        ? { kind: 'uncertain', message: '요청 확정 여부를 확인할 수 없습니다. 상세를 새로 불러와 생성 이력을 확인해 주세요.' }
        : { kind: 'failed', message: `AI 생성 연결을 사용할 수 없습니다. ${manualGuidance(action)}` });
    }
  };

  const retry = async () => {
    if (state.kind !== 'failed' || state.run === undefined ||
      (state.run.status !== 'failed' && state.run.status !== 'cancelled')) {
      await start();
      return;
    }
    const requestSequence = ++sequence.current;
    setState({ kind: 'preparing' });
    try {
      const prepared = await invoke('M-047', scope, { kind: 'retry', runId: state.run.runId });
      if (!accept(requestSequence)) return;
      if (!prepared.ok || prepared.value.preparation?.kind !== 'retry') {
        setState({ kind: 'failed', message: `현재 입력으로 다시 시도할 수 없습니다. ${manualGuidance(action)}` });
        return;
      }
      const requested = await invoke('M-035', {
        ...scope,
        guard: { expectedInputFingerprint: prepared.value.preparation.expectedInputFingerprint },
      }, state.run.runId);
      if (!accept(requestSequence)) return;
      if (!requested.ok) {
        setState({ kind: 'failed', message: `${requested.error.message} ${manualGuidance(action)}` });
        return;
      }
      await poll(requested.value, requestSequence);
    } catch {
      if (accept(requestSequence)) {
        setState({ kind: 'failed', message: `다시 시도하지 못했습니다. ${manualGuidance(action)}` });
      }
    }
  };

  return <section className="generation-assistant" aria-label="AI 초안 도우미">
    <div className="generation-assistant__heading">
      <div>
        <p className="generation-assistant__eyebrow">초안 도우미</p>
        <h2>{planning ? 'AI로 진행 계획 초안을 만듭니다' : 'AI로 요구사항을 정리합니다'}</h2>
      </div>
      <span>{owner ? '담당자 실행 가능' : '담당자만 실행'}</span>
    </div>
    <p>현재 저장된 설명, 자료, 답변을 고정해 초안을 만듭니다. 질문 선택, 답변, 문서 적용과 승인은 사람이 따로 확인합니다.</p>
    {owner && !planning && <div className="generation-assistant__choices" role="group" aria-label="요구사항 AI 작업 선택">
      <button type="button" disabled={working} aria-pressed={action === 'questions'} onClick={() => { setAction('questions'); setState({ kind: 'idle' }); }}>질문 정리</button>
      <button type="button" disabled={working} aria-pressed={action === 'document'} onClick={() => { setAction('document'); setState({ kind: 'idle' }); }}>요구사항 문서</button>
    </div>}
    {!owner && <p className="generation-assistant__notice">현재 SR 담당자가 AI 초안을 요청할 수 있습니다. 다른 구성원은 저장된 초안과 진행 상태를 볼 수 있습니다.</p>}
    {owner && <div className="generation-assistant__actions">
      <button type="button" className="primary-button" disabled={!owner || working} onClick={() => void start()}>
        {action === 'questions' ? 'AI로 질문 정리' : planning ? 'AI로 진행 계획 만들기' : 'AI로 요구사항 문서 만들기'}
      </button>
      {state.kind === 'failed' && <button type="button" disabled={!owner || working} onClick={() => void retry()}>다시 시도</button>}
      {state.kind === 'uncertain' && <button type="button" onClick={onSaved}>생성 이력 새로고침</button>}
    </div>}
    {state.kind === 'idle' && existingActiveRun !== undefined && <div className="generation-assistant__status generation-assistant__status--waiting" role="status">
      {existingActiveRun.status === 'pending' ? '담당자가 요청한 AI 작업이 실행을 기다리고 있습니다.' : '담당자가 요청한 AI 작업을 정리하고 있습니다.'}
    </div>}
    {state.kind !== 'idle' && <div className={`generation-assistant__status generation-assistant__status--${state.kind}`} role="status">
      {state.kind === 'checking' && 'AI 생성 준비 상태를 확인하고 있습니다.'}
      {state.kind === 'preparing' && '현재 저장 자료를 생성 입력으로 고정하고 있습니다.'}
      {state.kind === 'requesting' && 'AI 작업을 대기열에 등록하고 있습니다.'}
      {state.kind === 'waiting' && `${state.run.status === 'pending' ? '실행 대기 중' : 'AI가 정리 중'}`}
      {state.kind === 'completed' && <>초안을 저장했습니다. {onReviewDraft !== undefined && <button type="button" onClick={onReviewDraft}>초안 검토로 이동</button>}</>}
      {(state.kind === 'failed' || state.kind === 'uncertain') && state.message}
    </div>}
  </section>;
}
