import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDirty } from '../../app/WorkspaceShell.js';
import { ConfirmDialog } from '../../sr-document-foundation/ui/ConfirmDialog.js';
import { api, versionRoute } from '../../shared/client/api-client.js';
import type { PlanningAction, PlanningQuestion, RunView, WorkflowView } from '../../shared/planning-contracts.js';
import { answersComplete, isRun, isWorkflow, planningPath, PlanningMutation, type PlanningMutationState } from './planning-client.js';
import { grillBoot, grillRespond } from './grill-chat.js';
import './planning.css';

const labels: Record<PlanningAction, string> = { generate: '계획 생성', revise: '수정하여 다시 생성', next: '다음 단계 생성' };
const statuses: Record<WorkflowView['status'], string> = { idle: '시작 전', running: '생성 중', awaiting_answers: '응답 대기', awaiting_approval: '검토 대기', approved: '승인됨', changes_requested: '수정 요청됨', failed: '생성 실패', complete: '계획 완료' };

// 요구사항 분석 단계에서만 grill-me 식 대화형 질문 UI를 사용한다.
const REQUIREMENTS_STAGE = 'requirements-analysis';
// 선택한 보기(opt:index)나 직접 입력(custom)을 질문별로 보관하는 초안 상태.
type Draft = { id: string; mode: Record<string, string>; custom: Record<string, string> };
const blankDraft = (id = ''): Draft => ({ id, mode: {}, custom: {} });
function answerFor(q: PlanningQuestion, draft: Draft): string {
  const mode = draft.mode[q.id];
  if (mode && mode.startsWith('opt:')) return q.options[Number(mode.slice(4))] ?? '';
  return draft.custom[q.id] ?? '';
}
// 해당 질문에 유효한 답이 채워졌는지 (보기 선택 또는 비어있지 않은 직접 입력).
function isAnswered(q: PlanningQuestion, draft: Draft): boolean {
  const mode = draft.mode[q.id];
  if (q.options.length > 0) {
    if (mode?.startsWith('opt:')) return true;
    if (mode !== 'custom') return false;
  }
  return (draft.custom[q.id] ?? '').trim().length > 0;
}
// 답변 직후 requirements grilling 을 자동으로 이어갈 상태인지 판정한다.
function isGrillingContinue(v: WorkflowView): boolean {
  return v.stage === REQUIREMENTS_STAGE && v.status === 'idle' && v.reviewTargets.length === 0
    && !!v.questionSet?.answers && answersComplete(v.questionSet.questions, v.questionSet.answers);
}
function GrillQuestion({ q, draft, disabled, onChange }: { q: PlanningQuestion; draft: Draft; disabled: boolean; onChange: (draft: Draft) => void }) {
  const mode = draft.mode[q.id];
  const setCustom = (value: string) => onChange({ ...draft, custom: { ...draft.custom, [q.id]: value } });
  return <fieldset className="planning-question grill" data-testid={`planning-question-${q.id}`}>
    <legend>{q.prompt}</legend>
    {q.options.length === 0
      // 보기가 없는 질문(자유 서술형)은 텍스트 입력만 보여준다.
      ? <textarea data-testid={`planning-answer-${q.id}-input`} autoFocus disabled={disabled} placeholder="여기에 자유롭게 답해 주세요" value={draft.custom[q.id] ?? ''} onChange={e => setCustom(e.target.value)} />
      : <>
        {q.options.map((option, index) => <label className="grill-option" key={index}>
          <input type="radio" name={`planning-answer-${q.id}`} data-testid={`planning-option-${q.id}-${index}`} checked={mode === `opt:${index}`} disabled={disabled} onChange={() => onChange({ ...draft, mode: { ...draft.mode, [q.id]: `opt:${index}` } })} />
          <span>{option}</span>
        </label>)}
        <label className="grill-option">
          <input type="radio" name={`planning-answer-${q.id}`} data-testid={`planning-option-${q.id}-custom`} checked={mode === 'custom'} disabled={disabled} onChange={() => onChange({ ...draft, mode: { ...draft.mode, [q.id]: 'custom' } })} />
          <span>직접 입력</span>
        </label>
        {mode === 'custom' && <textarea data-testid={`planning-answer-${q.id}-input`} autoFocus disabled={disabled} value={draft.custom[q.id] ?? ''} onChange={e => setCustom(e.target.value)} />}
      </>}
  </fieldset>;
}
// grill-me 터미널: 현재 질문·선택지를 놓고 사용자가 되물으면 예시 데이터 기반으로 답하고,
// 원하면 그 자리에서 답(보기)을 골라준다. 실제 실시간 AI 호출은 아니다(프론트 전용).
type Line = { who: 'ai' | 'you' | 'sys'; text: string };
function GrillTerminal({ q, pickedIndex, disabled, onSelect }: { q: PlanningQuestion; pickedIndex: number | null; disabled: boolean; onSelect: (index: number) => void }) {
  const [lines, setLines] = useState<Line[]>(() => [{ who: 'sys', text: 'grill.sh · 질문 이해 도우미 (예시 데이터 기반, 실시간 AI 아님)' }, ...grillBoot(q).map(text => ({ who: 'ai' as const, text }))]);
  const [input, setInput] = useState(''); const [thinking, setThinking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null); const pickedRef = useRef(pickedIndex); pickedRef.current = pickedIndex;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lines, thinking]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const send = () => {
    const value = input.trim(); if (!value || thinking || disabled) return;
    setInput(''); setThinking(true);
    setLines(prev => [...prev, { who: 'you', text: value }]);
    const reply = grillRespond(q, value, pickedRef.current);
    window.setTimeout(() => {
      setLines(prev => [...prev, { who: 'ai', text: reply.text }]);
      if (reply.select != null) onSelect(reply.select);
      setThinking(false); inputRef.current?.focus();
    }, 340);
  };
  const mark = (who: Line['who']) => who === 'you' ? '$' : who === 'sys' ? '#' : '›';
  return <div className="grill-terminal" data-testid="planning-grill-terminal">
    <div className="grill-term-bar"><span className="gt-dot" /><span className="gt-dot" /><span className="gt-dot" /><span className="gt-title">grill@planrepo — {q.id}</span></div>
    <div className="grill-term-log" ref={logRef} role="log" aria-live="polite">
      {lines.map((l, i) => <div key={i} className={`gt-line gt-${l.who}`}><span className="gt-mark" aria-hidden="true">{mark(l.who)}</span><span className="gt-text">{l.text}</span></div>)}
      {thinking && <div className="gt-line gt-ai"><span className="gt-mark" aria-hidden="true">›</span><span className="gt-text gt-typing">●●●</span></div>}
    </div>
    <div className="grill-term-input">
      <span className="gt-prompt" aria-hidden="true">$</span>
      <input ref={inputRef} data-testid="planning-grill-terminal-input" value={input} disabled={disabled || thinking} aria-label="질문에 대해 되묻기" placeholder="차이·추천·뜻·왜 등 무엇이든 물어보세요" onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); send(); } }} />
      <button type="button" className="gt-send" data-testid="planning-grill-terminal-send" disabled={disabled || thinking || !input.trim()} onClick={send}>보내기</button>
    </div>
  </div>;
}
// 생성된 질문들을 한 번에 하나씩(grill-me) 물어보는 모달. 진행도/개수를 표시하고, 마지막에 모든 답을 한 번에 제출한다.
function GrillModal({ questions, draft, step, busy, requirements, canFinalize, onChange, setStep, onSubmit, onFinalize, onClose }: {
  questions: PlanningQuestion[]; draft: Draft; step: number; busy: boolean; requirements: boolean; canFinalize: boolean;
  onChange: (draft: Draft) => void; setStep: (next: number) => void; onSubmit: () => void; onFinalize: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = ref.current!; dialog.showModal(); return () => { dialog.close(); previous?.focus(); }; }, []);
  const total = questions.length;
  const index = Math.min(Math.max(step, 0), total - 1);
  const q = questions[index]!;
  const answeredCount = questions.filter(x => isAnswered(x, draft)).length;
  const allAnswered = answeredCount === total;
  const currentAnswered = isAnswered(q, draft);
  const last = index === total - 1;
  const mode = draft.mode[q.id];
  const pickedIndex = mode?.startsWith('opt:') ? Number(mode.slice(4)) : null;
  // "grill me": 터미널을 열어 현재 질문·선택지를 자유롭게 되물으며 끝까지 이해하도록 돕는다.
  const [term, setTerm] = useState(false);
  useEffect(() => { setTerm(false); }, [index]);
  const advance = () => { if (last) { if (allAnswered) onSubmit(); } else if (currentAnswered) setStep(index + 1); };
  return <dialog ref={ref} className="grill-modal" aria-labelledby="grill-title" data-testid="planning-grill-modal" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="grill-head">
      <div><p className="eyebrow">{requirements ? '의도 확인' : '질문 확인'}</p><h2 id="grill-title">질문 {index + 1} <span className="grill-total">/ {total}</span></h2></div>
      <button type="button" className="grill-close" data-testid="planning-grill-close-button" disabled={busy} aria-label="모달 닫기" onClick={onClose}>✕</button>
    </div>
    <div className="grill-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answeredCount} aria-label={`${total}개 중 ${answeredCount}개 답변함`}>
      {questions.map((x, i) => <span key={i} className={`grill-dot${i === index ? ' current' : ''}${isAnswered(x, draft) ? ' done' : ''}`} />)}
    </div>
    <p className="grill-lead">{requirements ? '원하시는 의도를 정확히 이해하려고 해요. 아래에서 가장 가까운 것을 골라 주세요.' : '이해를 돕기 위해 하나씩 여쭤볼게요. 가장 가까운 답을 고르거나 직접 적어 주세요.'}</p>
    <form data-testid="planning-answers-form" onSubmit={e => { e.preventDefault(); advance(); }}>
      <GrillQuestion q={q} draft={draft} disabled={busy} onChange={onChange} />
      {term && <GrillTerminal key={q.id} q={q} pickedIndex={pickedIndex} disabled={busy} onSelect={i => onChange({ ...draft, mode: { ...draft.mode, [q.id]: `opt:${i}` } })} />}
      <div className="grill-nav">
        <button type="button" className="quiet" data-testid="planning-grill-prev-button" disabled={busy || index === 0} onClick={() => setStep(index - 1)}>← 이전</button>
        <span className="grill-count muted">{answeredCount} / {total} 답변함</span>
        <div className="grill-nav-right">
          <button type="button" className="grill-me" data-testid="planning-grill-me-button" aria-pressed={term} onClick={() => setTerm(v => !v)}>🔎 grill me</button>
          {last
            ? <button type="submit" className="primary" data-testid="planning-answers-submit-button" disabled={busy || !allAnswered}>{requirements ? '답변하고 계속' : '응답 저장'}</button>
            : <button type="button" className="primary" data-testid="planning-grill-next-button" disabled={busy || !currentAnswered} onClick={() => setStep(index + 1)}>다음 →</button>}
        </div>
      </div>
      {canFinalize && <div className="grill-finalize"><button type="button" className="quiet" data-testid="planning-finalize-button" disabled={busy} onClick={onFinalize}>이만 충분해요 · 지금 요구사항 생성</button></div>}
    </form>
  </dialog>;
}
type Props = { srId: string; revision: number; changed: () => void };
export function PlanningPanel(props: Props) { return <PlanningPanelContent key={props.srId} {...props} />; }
function PlanningPanelContent({ srId, revision, changed }: Props) {
  const [view, setView] = useState<WorkflowView>(); const [run, setRun] = useState<RunView>();
  const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [comment, setComment] = useState(''); const [mutation, setMutation] = useState<PlanningMutationState>({ status: 'idle' });
  const [confirmNewAttempt, setConfirmNewAttempt] = useState(false); const [preparing, setPreparing] = useState(false);
  const mounted = useRef(true); const changedRef = useRef(changed); changedRef.current = changed; const autoAdvance = useRef(false);
  const tracker = useMemo(() => new PlanningMutation(srId, state => { if (mounted.current) setMutation(state); }), [srId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const apply = useCallback((value: WorkflowView) => { setView(value); setRun(value.latestRun); setError(''); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api.request(`${planningPath(srId)}/workflow`, isWorkflow, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) apply(value); }).catch(() => { if (!controller.signal.aborted) setError('계획 상태를 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, [srId, revision, reload, apply]);
  const runId = run?.status === 'running' ? run.id : view?.status === 'running' ? view.latestRunId : undefined;
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api.request(`${planningPath(srId)}/runs/${encodeURIComponent(runId)}`, isRun, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (value.status !== 'running') {
          const workflow = await api.request(`${planningPath(srId)}/workflow`, isWorkflow, { signal: controller.signal });
          if (!controller.signal.aborted) { apply(workflow); setRun(value); changedRef.current(); }
          return;
        }
        setRun(value); setError('');
      } catch { if (!controller.signal.aborted) setError('실행 상태 조회에 실패했습니다. 다시 확인해 주세요.'); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [srId, runId, apply]);
  const handled = useRef<string | undefined>(undefined);
  const submittedKind = useRef<'advance' | 'answers' | 'decisions' | 'complete' | undefined>(undefined);
  useEffect(() => {
    if (mutation.status !== 'succeeded' || !mutation.data || handled.current === mutation.operationId) return;
    handled.current = mutation.operationId;
    if ('actions' in mutation.data) apply(mutation.data); else { setRun(mutation.data); setReload(n => n + 1); }
    if (submittedKind.current === 'answers') {
      setDraft(blankDraft());
      // 요구사항 grilling 중 답변이 저장되면 다음 질문 라운드를 자동으로 이어 간다.
      if ('actions' in mutation.data && isGrillingContinue(mutation.data)) autoAdvance.current = true;
    }
    if (submittedKind.current === 'decisions') setComment('');
    changedRef.current();
  }, [mutation, apply]);
  const questionSet = view?.questionSet;
  const [step, setStep] = useState(0); const [closed, setClosed] = useState(false);
  // 새 질문 세트가 도착하면 진행 위치와 닫힘 상태를 초기화한다.
  useEffect(() => { setStep(0); setClosed(false); }, [questionSet?.id]);
  const active = questionSet && draft.id === questionSet.id ? draft : blankDraft(questionSet?.id);
  const setActive = (next: Draft) => { if (questionSet) setDraft({ ...next, id: questionSet.id }); };
  const answers = questionSet ? Object.fromEntries(questionSet.questions.map(q => [q.id, answerFor(q, active)])) : {};
  const grilling = !!view && view.stage === REQUIREMENTS_STAGE && view.reviewTargets.length === 0 && !!questionSet && (view.status === 'awaiting_answers' || view.status === 'idle');
  // 답변이 필요한 질문이 있으면 모달을 연다 (사용자가 닫기 전까지). 모든 단계에 적용.
  const pending = !!view && !!questionSet && !questionSet.answers && questionSet.questions.length > 0 && view.status === 'awaiting_answers';
  const modalOpen = pending && !closed;
  const hasDraft = Object.keys(active.mode).length > 0 || Object.values(active.custom).some(t => t.trim().length > 0) || comment.length > 0;
  useDirty(hasDraft || mutation.status === 'saving' || mutation.status === 'unknown');
  const busy = mutation.status === 'saving' || mutation.status === 'unknown' || view?.status === 'running' || run?.status === 'running';
  async function submit(kind: 'advance' | 'answers' | 'decisions' | 'complete', body: Record<string, unknown>) {
    if (!view || busy) return;
    submittedKind.current = kind;
    await tracker.submit(kind, { ...body, revision: view.revision });
  }
  // grilling 답변 후 다음 질문 라운드를 자동 실행한다 (한 번만, 최신 view/revision 으로 제출).
  useEffect(() => {
    if (!autoAdvance.current || !view || busy) return;
    autoAdvance.current = false;
    if (isGrillingContinue(view)) void submit('advance', { action: 'generate' });
  }, [view, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="planning-panel" data-testid="planning-panel" aria-labelledby="planning-heading">
    <div className="planning-heading"><div><h2 id="planning-heading">계획 진행</h2><p className="muted">단계별 계획을 생성하고 검토해 주세요.</p></div>{view && <span className="planning-status" role="status">{statuses[run?.status === 'running' ? 'running' : view.status]}</span>}</div>
    {error && <div role="alert" className="notice error"><p>{error}</p><button data-testid="planning-refresh-button" onClick={() => setReload(n => n + 1)}>다시 확인</button></div>}
    {!view && !error && <p role="status">계획 상태를 불러오는 중…</p>}
    {view && <><div className="planning-phase"><strong>{view.stageLabel}</strong><span>Inception {view.inceptionCycle}회 · Construction {view.constructionCycle}회</span></div>
      <div className="planning-actions">{view.actions.map(action => <button key={action} data-testid={`planning-${action}-button`} disabled={busy} onClick={() => void submit('advance', { action })}>{grilling && action === 'generate' ? '이어서 질문받기' : labels[action]}</button>)}{grilling && view.status === 'idle' && <button type="button" data-testid="planning-finalize-button" disabled={busy} onClick={() => void submit('advance', { action: 'generate', finalize: true })}>이만 충분해요 · 요구사항 생성</button>}{view.canComplete && <button data-testid="planning-complete-button" disabled={busy} onClick={() => void submit('complete', {})}>계획 완료 · 구현 대기로 이동</button>}</div>
      {view.blockedReason && <p className="muted">{view.blockedReason}</p>}
      {run?.status === 'running' && <p role="status">계획을 생성하고 있습니다. 완료되면 문서와 이력이 갱신됩니다.</p>}
      {run?.error && <div role="alert" className="notice error">{run.error.message}</div>}
      {run?.summary && <p className="planning-summary">{run.summary}</p>}
      {pending && closed && <div className="planning-question planning-grill-reopen"><p className="muted">답변이 필요한 질문 {questionSet.questions.length}개가 있습니다.</p><button type="button" data-testid="planning-grill-open-button" disabled={busy} onClick={() => { setStep(0); setClosed(false); }}>질문 {questionSet.questions.length}개 열기</button></div>}
      {view.reviewTargets.length > 0 && <div className="planning-review"><h3>검토할 문서 · {view.reviewTargets.length}개</h3><ul>{view.reviewTargets.map((ref, index) => <li key={ref.documentId}><Link data-testid={`planning-review-document-${index}-link`} to={versionRoute(ref)}>생성 문서 {index + 1} 보기</Link></li>)}</ul>{['awaiting_approval', 'approved', 'changes_requested'].includes(view.status) && <form data-testid="planning-decision-form" onSubmit={e => { e.preventDefault(); void submit('decisions', { kind: 'approve', comment, targets: view.reviewTargets }); }}><label htmlFor="planning-comment">검토 의견 (수정 요청 시 필수)</label><textarea id="planning-comment" data-testid="planning-comment-input" value={comment} disabled={busy} onChange={e => setComment(e.target.value)} /><div className="planning-actions"><button data-testid="planning-approve-button" disabled={busy}>현재 문서 전체 승인</button><button type="button" data-testid="planning-request-changes-button" disabled={busy || !comment.trim()} onClick={() => void submit('decisions', { kind: 'request_changes', comment, targets: view.reviewTargets })}>수정 요청</button></div></form>}</div>}
    </>}
    {modalOpen && questionSet && view && <GrillModal
      questions={questionSet.questions} draft={active} step={step} busy={busy}
      requirements={view.stage === REQUIREMENTS_STAGE} canFinalize={grilling}
      onChange={setActive} setStep={setStep}
      onSubmit={() => void submit('answers', { questionSetId: questionSet.id, answers })}
      onFinalize={() => void submit('advance', { action: 'generate', finalize: true })}
      onClose={() => setClosed(true)} />}
    {mutation.error && <div className="notice error" role="alert">{mutation.error.message}<button data-testid="planning-conflict-refresh-button" onClick={() => setReload(n => n + 1)}>최신 상태 확인</button></div>}
    {mutation.status === 'saving' && <p role="status">처리 중…</p>}
    {mutation.status === 'unknown' && <div role="alert" className="notice"><p>{mutation.message}</p><div className="planning-actions"><button data-testid="planning-operation-check-button" disabled={preparing} onClick={() => void tracker.check()}>처리 결과 다시 확인</button><button data-testid="planning-operation-reset-button" disabled={preparing} onClick={() => setConfirmNewAttempt(true)}>새 시도 준비</button></div></div>}
    {confirmNewAttempt && <ConfirmDialog title="새 시도를 준비할까요?" label="최신 상태 확인 후 준비" busy={preparing} cancel={() => setConfirmNewAttempt(false)} confirm={() => {
      setPreparing(true);
      void tracker.prepareNewAttempt(true).then(workflow => { if (mounted.current && workflow) apply(workflow); }).finally(() => { if (mounted.current) { setPreparing(false); setConfirmNewAttempt(false); } });
    }}><p>이전 요청의 처리 결과는 아직 알 수 없습니다. 새 시도에는 새로운 요청 번호가 사용되어 같은 작업이 중복될 수 있습니다.</p><p>최신 상태를 확인한 뒤 입력을 유지합니다. 작업을 실행하려면 원하는 동작을 다시 눌러 주세요.</p></ConfirmDialog>}
  </section>;
}
