import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { WorktreeInteractionStatus, WorktreeSpikeView, WorktreeTranscriptRole } from '../contracts.js';
import { WorktreeSpikeClient, worktreeSpikeClient } from './worktree-spike-client.js';

export interface WorktreeSpikePanelProps {
  srId: string;
  revision?: number;
  client?: WorktreeSpikeClient;
  changed?: () => void;
}

const ACTIVE_STATUSES = new Set<WorktreeInteractionStatus>(['running', 'awaiting_input', 'finishing']);
const ROLE_LABELS: Record<WorktreeTranscriptRole, string> = { user: '나', assistant: 'Claude', status: '상태', error: '오류' };

export const isWorktreeInteractionActive = (status?: WorktreeInteractionStatus): boolean => !!status && ACTIVE_STATUSES.has(status);
export const shouldSubmitInteractionMessage = (key: string, shiftKey: boolean, isComposing = false): boolean => key === 'Enter' && !shiftKey && !isComposing;

interface WorktreeInteractionProps {
  srId: string;
  view: WorktreeSpikeView;
  client: WorktreeSpikeClient;
  update: (view: WorktreeSpikeView) => void;
  changed?: () => void;
}

export function WorktreeInteraction({ srId, view, client, update, changed }: WorktreeInteractionProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'message' | 'finish' | 'cancel'>();
  const [error, setError] = useState<string>();
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const active = isWorktreeInteractionActive(view.interactionStatus);
  const transcript = [...(view.transcript ?? [])].sort((left, right) => left.sequence - right.sequence);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: 'nearest' }); }, [transcript.length]);

  const act = async (action: 'message' | 'finish' | 'cancel') => {
    if (busy || !active || (action === 'message' && !message.trim())) return;
    setBusy(action); setError(undefined);
    try {
      const next = action === 'message' ? await client.message(srId, message) : await client[action](srId);
      update(next);
      if (action === 'message') setMessage('');
      changed?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Claude 대화 요청을 완료하지 못했습니다.');
    } finally {
      setBusy(undefined);
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSubmitInteractionMessage(event.key, event.shiftKey, event.nativeEvent.isComposing)) return;
    event.preventDefault();
    void act('message');
  };

  return <div className="worktree-interaction">
    <div className="worktree-interaction-heading">
      <h3>Claude 대화</h3>
      <span className={`badge interaction-${view.interactionStatus ?? 'idle'}`} data-testid="worktree-interaction-status">{view.interactionStatus ?? 'idle'}</span>
    </div>
    <div className="worktree-interaction-transcript" data-testid="worktree-interaction-transcript" role="log" aria-live="polite">
      {transcript.length ? transcript.map(entry => <article key={entry.sequence} className={`worktree-transcript-entry transcript-${entry.role}`}>
        <header><strong>{ROLE_LABELS[entry.role]}</strong><time dateTime={entry.createdAt}>#{entry.sequence}</time></header>
        <p>{entry.text}</p>
      </article>) : <p className="empty">아직 대화 내용이 없습니다.</p>}
      <div ref={transcriptEnd} />
    </div>
    {error && <p role="alert" className="notice error" data-testid="worktree-interaction-error">{error}</p>}
    <label className="worktree-interaction-composer">
      <span>메시지</span>
      <textarea
        data-testid="worktree-interaction-message-input"
        rows={3}
        value={message}
        disabled={!active || !!busy}
        placeholder={active ? 'Claude에 보낼 메시지를 입력하세요. Enter 전송, Shift+Enter 줄바꿈' : 'AI-DLC 이어서 실행 후 메시지를 입력할 수 있습니다.'}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={keyDown}
      />
    </label>
    <div className="actions worktree-interaction-actions">
      <button type="button" data-testid="worktree-interaction-cancel-button" disabled={!active || !!busy} onClick={() => void act('cancel')}>{busy === 'cancel' ? '취소 중…' : '실행 취소'}</button>
      <button type="button" data-testid="worktree-interaction-finish-button" disabled={!active || !!busy} onClick={() => void act('finish')}>{busy === 'finish' ? '종료 중…' : '입력 종료'}</button>
      <button type="button" className="primary" data-testid="worktree-interaction-send-button" disabled={!active || !!busy || !message.trim()} onClick={() => void act('message')}>{busy === 'message' ? '전송 중…' : '메시지 전송'}</button>
    </div>
  </div>;
}

export function WorktreeSpikePanel({ srId, revision = 0, client = worktreeSpikeClient, changed }: WorktreeSpikePanelProps) {
  const [view, setView] = useState<WorktreeSpikeView>();
  const [busy, setBusy] = useState<'loading' | 'provision' | 'resume' | undefined>('loading');
  const [error, setError] = useState<string>();
  const generation = useRef(0);

  const load = useCallback(async (visible = true) => {
    const current = generation.current;
    if (visible) { setBusy('loading'); setError(undefined); }
    try {
      const next = await client.status(srId);
      if (current === generation.current) setView(next);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Worktree 상태를 읽지 못했습니다.');
    } finally {
      if (visible && current === generation.current) setBusy(undefined);
    }
  }, [client, srId]);

  useEffect(() => {
    generation.current++;
    void load();
    return () => { generation.current++; };
  }, [load, revision]);

  useEffect(() => {
    if (!isWorktreeInteractionActive(view?.interactionStatus)) return;
    const timer = setInterval(() => void load(false), 500);
    return () => clearInterval(timer);
  }, [load, view?.interactionStatus]);

  const mutate = async (action: 'provision' | 'resume') => {
    if (busy) return;
    const current = generation.current;
    setBusy(action); setError(undefined);
    try {
      const next = await client[action](srId);
      if (current === generation.current) { setView(next); changed?.(); }
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Worktree 작업을 완료하지 못했습니다.');
    } finally {
      if (current === generation.current) setBusy(undefined);
    }
  };

  const active = isWorktreeInteractionActive(view?.interactionStatus);
  return <section className="worktree-spike-panel" data-testid="worktree-spike-panel" aria-labelledby="worktree-spike-title">
    <div className="section-heading">
      <div><p className="eyebrow">WORKTREE SPIKE</p><h2 id="worktree-spike-title">로컬 AI-DLC 실행</h2></div>
      <button type="button" data-testid="worktree-spike-reload-button" disabled={!!busy} onClick={() => void load()}>새로고침</button>
    </div>
    {busy === 'loading' && <p role="status" data-testid="worktree-spike-loading">상태 확인 중…</p>}
    {error && <p role="alert" className="notice error" data-testid="worktree-spike-error">{error}</p>}
    {view && <>
      {!view.configured && <p className="notice" data-testid="worktree-spike-unconfigured">로컬 repository 경로를 먼저 설정해 주세요.</p>}
      <dl className="worktree-spike-status">
        <div><dt>준비 상태</dt><dd data-testid="worktree-spike-readiness">{view.readiness === 'ready' ? '준비됨' : '미준비'}</dd></div>
        <div><dt>현재 단계</dt><dd data-testid="worktree-spike-current-stage">{view.currentStage ?? '확인되지 않음'}</dd></div>
        <div><dt>첫 미완료 항목</dt><dd data-testid="worktree-spike-first-incomplete">{view.firstIncomplete ?? '확인되지 않음'}</dd></div>
        <div><dt>실행 상태</dt><dd data-testid="worktree-spike-run-status">{view.runStatus}</dd></div>
      </dl>
      <div className="planning-actions">
        <button type="button" data-testid="worktree-spike-provision-button" disabled={!!busy || active || !view.configured} onClick={() => void mutate('provision')}>{busy === 'provision' ? '준비 중…' : 'Worktree 준비'}</button>
        <button type="button" data-testid="worktree-spike-resume-button" disabled={!!busy || active || !view.configured || view.readiness !== 'ready'} onClick={() => void mutate('resume')}>{busy === 'resume' ? '실행 중…' : 'AI-DLC 이어서 실행'}</button>
      </div>
      <WorktreeInteraction srId={srId} view={view} client={client} update={setView} changed={changed} />
      <div data-testid="worktree-spike-changed-paths">
        <h3>변경된 관리 파일</h3>
        {view.changedPaths.length ? <ul>{view.changedPaths.map(path => <li key={path}>{path}</li>)}</ul> : <p>변경 없음</p>}
      </div>
    </>}
  </section>;
}
