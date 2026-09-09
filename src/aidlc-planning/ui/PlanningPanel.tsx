import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDirty } from '../../app/WorkspaceShell.js';
import { ConfirmDialog } from '../../sr-document-foundation/ui/ConfirmDialog.js';
import { api, versionRoute } from '../../shared/client/api-client.js';
import type { PlanningAction, RunView, WorkflowView } from '../../shared/planning-contracts.js';
import { answersComplete, isRun, isWorkflow, planningPath, PlanningMutation, type PlanningMutationState } from './planning-client.js';
import './planning.css';

const labels: Record<PlanningAction, string> = { generate: '계획 생성', revise: '수정하여 다시 생성', next: '다음 단계 생성' };
const statuses: Record<WorkflowView['status'], string> = { idle: '시작 전', running: '생성 중', awaiting_answers: '응답 대기', awaiting_approval: '검토 대기', approved: '승인됨', changes_requested: '수정 요청됨', failed: '생성 실패', complete: '계획 완료' };
type Props = { srId: string; revision: number; changed: () => void };
export function PlanningPanel(props: Props) { return <PlanningPanelContent key={props.srId} {...props} />; }
function PlanningPanelContent({ srId, revision, changed }: Props) {
  const [view, setView] = useState<WorkflowView>(); const [run, setRun] = useState<RunView>();
  const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<{ id: string; answers: Record<string, string> }>({ id: '', answers: {} });
  const [comment, setComment] = useState(''); const [mutation, setMutation] = useState<PlanningMutationState>({ status: 'idle' });
  const [confirmNewAttempt, setConfirmNewAttempt] = useState(false); const [preparing, setPreparing] = useState(false);
  const mounted = useRef(true); const changedRef = useRef(changed); changedRef.current = changed;
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
    if (submittedKind.current === 'answers') setDraft({ id: '', answers: {} });
    if (submittedKind.current === 'decisions') setComment('');
    changedRef.current();
  }, [mutation, apply]);
  const questionSet = view?.questionSet; const answers = draft.id === questionSet?.id ? draft.answers : {};
  const hasDraft = Object.values(draft.answers).some(a => a.length > 0) || comment.length > 0;
  useDirty(hasDraft || mutation.status === 'saving' || mutation.status === 'unknown');
  const busy = mutation.status === 'saving' || mutation.status === 'unknown' || view?.status === 'running' || run?.status === 'running';
  async function submit(kind: 'advance' | 'answers' | 'decisions' | 'complete', body: Record<string, unknown>) {
    if (!view || busy) return;
    submittedKind.current = kind;
    await tracker.submit(kind, { ...body, revision: view.revision });
  }
  return <section className="planning-panel" data-testid="planning-panel" aria-labelledby="planning-heading">
    <div className="planning-heading"><div><h2 id="planning-heading">계획 진행</h2><p className="muted">단계별 계획을 생성하고 검토해 주세요.</p></div>{view && <span className="planning-status" role="status">{statuses[run?.status === 'running' ? 'running' : view.status]}</span>}</div>
    {error && <div role="alert" className="notice error"><p>{error}</p><button data-testid="planning-refresh-button" onClick={() => setReload(n => n + 1)}>다시 확인</button></div>}
    {!view && !error && <p role="status">계획 상태를 불러오는 중…</p>}
    {view && <><div className="planning-phase"><strong>{view.stageLabel}</strong><span>Inception {view.inceptionCycle}회 · Construction {view.constructionCycle}회</span></div>
      <div className="planning-actions">{view.actions.map(action => <button key={action} data-testid={`planning-${action}-button`} disabled={busy} onClick={() => void submit('advance', { action })}>{labels[action]}</button>)}{view.canComplete && <button data-testid="planning-complete-button" disabled={busy} onClick={() => void submit('complete', {})}>계획 완료 · 구현 대기로 이동</button>}</div>
      {view.blockedReason && <p className="muted">{view.blockedReason}</p>}
      {run?.status === 'running' && <p role="status">계획을 생성하고 있습니다. 완료되면 문서와 이력이 갱신됩니다.</p>}
      {run?.error && <div role="alert" className="notice error">{run.error.message}</div>}
      {run?.summary && <p className="planning-summary">{run.summary}</p>}
      {questionSet && !questionSet.answers && view.status === 'awaiting_answers' && <form data-testid="planning-answers-form" onSubmit={e => { e.preventDefault(); void submit('answers', { questionSetId: questionSet.id, answers }); }}><h3>확인이 필요한 질문</h3>{questionSet.questions.map(q => <div className="planning-question" key={q.id}><label htmlFor={`planning-answer-${q.id}`}>{q.prompt}</label>{q.options.length > 0 && <ul>{q.options.map((option, index) => <li key={index}>{option}</li>)}</ul>}<textarea id={`planning-answer-${q.id}`} data-testid={`planning-answer-${q.id}-input`} required disabled={busy} value={answers[q.id] ?? ''} onChange={e => setDraft({ id: questionSet.id, answers: { ...answers, [q.id]: e.target.value } })} /></div>)}<button data-testid="planning-answers-submit-button" disabled={busy || !answersComplete(questionSet.questions, answers)}>응답 저장</button></form>}
      {view.reviewTargets.length > 0 && <div className="planning-review"><h3>검토할 문서 · {view.reviewTargets.length}개</h3><ul>{view.reviewTargets.map((ref, index) => <li key={ref.documentId}><Link data-testid={`planning-review-document-${index}-link`} to={versionRoute(ref)}>생성 문서 {index + 1} 보기</Link></li>)}</ul>{['awaiting_approval', 'approved', 'changes_requested'].includes(view.status) && <form data-testid="planning-decision-form" onSubmit={e => { e.preventDefault(); void submit('decisions', { kind: 'approve', comment, targets: view.reviewTargets }); }}><label htmlFor="planning-comment">검토 의견 (수정 요청 시 필수)</label><textarea id="planning-comment" data-testid="planning-comment-input" value={comment} disabled={busy} onChange={e => setComment(e.target.value)} /><div className="planning-actions"><button data-testid="planning-approve-button" disabled={busy}>현재 문서 전체 승인</button><button type="button" data-testid="planning-request-changes-button" disabled={busy || !comment.trim()} onClick={() => void submit('decisions', { kind: 'request_changes', comment, targets: view.reviewTargets })}>수정 요청</button></div></form>}</div>}
    </>}
    {mutation.error && <div className="notice error" role="alert">{mutation.error.message}<button data-testid="planning-conflict-refresh-button" onClick={() => setReload(n => n + 1)}>최신 상태 확인</button></div>}
    {mutation.status === 'saving' && <p role="status">처리 중…</p>}
    {mutation.status === 'unknown' && <div role="alert" className="notice"><p>{mutation.message}</p><div className="planning-actions"><button data-testid="planning-operation-check-button" disabled={preparing} onClick={() => void tracker.check()}>처리 결과 다시 확인</button><button data-testid="planning-operation-reset-button" disabled={preparing} onClick={() => setConfirmNewAttempt(true)}>새 시도 준비</button></div></div>}
    {confirmNewAttempt && <ConfirmDialog title="새 시도를 준비할까요?" label="최신 상태 확인 후 준비" busy={preparing} cancel={() => setConfirmNewAttempt(false)} confirm={() => {
      setPreparing(true);
      void tracker.prepareNewAttempt(true).then(workflow => { if (mounted.current && workflow) apply(workflow); }).finally(() => { if (mounted.current) { setPreparing(false); setConfirmNewAttempt(false); } });
    }}><p>이전 요청의 처리 결과는 아직 알 수 없습니다. 새 시도에는 새로운 요청 번호가 사용되어 같은 작업이 중복될 수 있습니다.</p><p>최신 상태를 확인한 뒤 입력을 유지합니다. 작업을 실행하려면 원하는 동작을 다시 눌러 주세요.</p></ConfirmDialog>}
  </section>;
}
