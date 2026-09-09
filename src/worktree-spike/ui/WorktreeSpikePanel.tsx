import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorktreeSpikeView } from '../contracts.js';
import { WorktreeSpikeClient, worktreeSpikeClient } from './worktree-spike-client.js';

export interface WorktreeSpikePanelProps {
  srId: string;
  revision?: number;
  client?: WorktreeSpikeClient;
}

export function WorktreeSpikePanel({ srId, revision = 0, client = worktreeSpikeClient }: WorktreeSpikePanelProps) {
  const [view, setView] = useState<WorktreeSpikeView>();
  const [busy, setBusy] = useState<'loading' | 'provision' | 'resume' | undefined>('loading');
  const [error, setError] = useState<string>();
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setBusy('loading'); setError(undefined);
    try {
      const next = await client.status(srId);
      if (current === generation.current) setView(next);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Worktree 상태를 읽지 못했습니다.');
    } finally {
      if (current === generation.current) setBusy(previous => previous === 'loading' ? undefined : previous);
    }
  }, [client, srId]);

  useEffect(() => { void load(); return () => { generation.current++; }; }, [load, revision]);

  const mutate = async (action: 'provision' | 'resume') => {
    if (busy) return;
    const current = ++generation.current;
    setBusy(action); setError(undefined);
    try {
      const next = await client[action](srId);
      if (current === generation.current) setView(next);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Worktree 작업을 완료하지 못했습니다.');
    } finally {
      if (current === generation.current) setBusy(undefined);
    }
  };

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
        <button type="button" data-testid="worktree-spike-provision-button" disabled={!!busy || !view.configured} onClick={() => void mutate('provision')}>{busy === 'provision' ? '준비 중…' : 'Worktree 준비'}</button>
        <button type="button" data-testid="worktree-spike-resume-button" disabled={!!busy || !view.configured || view.readiness !== 'ready'} onClick={() => void mutate('resume')}>{busy === 'resume' ? '실행 중…' : 'AI-DLC 이어서 실행'}</button>
      </div>
      <div data-testid="worktree-spike-changed-paths">
        <h3>변경된 관리 파일</h3>
        {view.changedPaths.length ? <ul>{view.changedPaths.map(path => <li key={path}>{path}</li>)}</ul> : <p>변경 없음</p>}
      </div>
    </>}
  </section>;
}
