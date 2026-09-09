import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardView, SRDetailView, WorkspaceView } from '@/src/contracts/views';
import { invoke } from './api/client';
import { QueryCoordinator } from './state/query-coordinator';
import { SRRegistrationForm } from './components/SRRegistrationForm';
import { MyWork } from './components/MyWork';
import { TeamBoard } from './components/TeamBoard';
import { SRList } from './components/SRList';
import { SRDetailShell } from './components/SRDetailShell';
import { TeamPolicyEditor } from './components/TeamPolicyEditor';
import './styles/base.css';
import './styles/prototype.css';

declare const __PLANREPO_PROJECT_ID__: string;
declare const __PLANREPO_DEFAULT_ACTOR_ID__: string;

type Screen = 'board' | 'inbox' | 'list' | 'settings';
const actorStorageKey = `planrepo:${__PLANREPO_PROJECT_ID__}:actor`;

export function App() {
  const [actorId, setActorId] = useState(() => localStorage.getItem(actorStorageKey) ?? __PLANREPO_DEFAULT_ACTOR_ID__);
  const [workspace, setWorkspace] = useState<WorkspaceView>();
  const [board, setBoard] = useState<BoardView>();
  const [detail, setDetail] = useState<SRDetailView>();
  const [initialTab, setInitialTab] = useState<string | undefined>(() => new URLSearchParams(location.search).get('view') ?? undefined);
  const [selectedSrId, setSelectedSrId] = useState<string | undefined>(() => new URLSearchParams(location.search).get('sr') ?? undefined);
  const [screen, setScreen] = useState<Screen>('board');
  const [registering, setRegistering] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string>();
  const [boardError, setBoardError] = useState<string>();
  const [detailError, setDetailError] = useState<string>();
  const workspaceQueries = useRef(new QueryCoordinator());
  const boardQueries = useRef(new QueryCoordinator());
  const detailQueries = useRef(new QueryCoordinator());

  const loadWorkspace = useCallback(async (nextActorId: string) => {
    const ticket = workspaceQueries.current.issue({ actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__, target: 'workspace', methodId: 'M-001' });
    const result = await invoke('M-001', { actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__ }, {});
    if (!result.ok) throw new Error(result.error.message);
    const accepted = workspaceQueries.current.accept(ticket.key, ticket.seq, result.value);
    if (accepted.accepted) setWorkspace(accepted.value);
  }, []);

  const loadBoard = useCallback(async (nextActorId: string) => {
    const ticket = boardQueries.current.issue({ actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__, target: 'team-board', methodId: 'M-045' });
    setLoadingBoard(true);
    setBoardError(undefined);
    try {
      const result = await invoke('M-045', { actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__ }, {});
      if (!result.ok) throw new Error(result.error.message);
      const accepted = boardQueries.current.accept(ticket.key, ticket.seq, result.value);
      if (accepted.accepted) {
        setBoard(accepted.value);
        setLoadingBoard(false);
        setBoardError(undefined);
      }
    } catch (reason) {
      const accepted = boardQueries.current.accept(ticket.key, ticket.seq, reason);
      if (accepted.accepted) {
        setLoadingBoard(false);
        setBoardError(reason instanceof Error ? reason.message : '보드를 불러오지 못했습니다.');
      }
    }
  }, []);

  const loadDetail = useCallback(async (nextActorId: string, srId: string) => {
    const ticket = detailQueries.current.issue({ actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__, srId, target: srId, methodId: 'M-047' });
    setLoadingDetail(true);
    setDetailError(undefined);
    try {
      const result = await invoke('M-047', { actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__, srId }, {});
      if (!result.ok) throw new Error(result.error.message);
      const accepted = detailQueries.current.accept(ticket.key, ticket.seq, result.value);
      if (accepted.accepted) {
        setDetail(accepted.value);
        setLoadingDetail(false);
        setDetailError(undefined);
      }
    } catch (reason) {
      const accepted = detailQueries.current.accept(ticket.key, ticket.seq, reason);
      if (accepted.accepted) {
        setLoadingDetail(false);
        setDetailError(reason instanceof Error ? reason.message : 'SR 상세를 불러오지 못했습니다.');
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    workspaceQueries.current.issue({ actorId, projectId: __PLANREPO_PROJECT_ID__, target: 'workspace', methodId: 'M-001' });
    boardQueries.current.issue({ actorId, projectId: __PLANREPO_PROJECT_ID__, target: 'team-board', methodId: 'M-045' });
    detailQueries.current.issue({ actorId, projectId: __PLANREPO_PROJECT_ID__, target: 'no-sr-selected', methodId: 'M-047' });
    void (async () => {
      setError(undefined);
      const selected = await invoke('M-002', { projectId: __PLANREPO_PROJECT_ID__ }, actorId);
      if (!selected.ok) {
        if (actorId !== __PLANREPO_DEFAULT_ACTOR_ID__) { setActorId(__PLANREPO_DEFAULT_ACTOR_ID__); return; }
        throw new Error(selected.error.message);
      }
      if (!active) return;
      localStorage.setItem(actorStorageKey, actorId);
      await Promise.all([loadWorkspace(actorId), loadBoard(actorId)]);
    })().catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '작업 공간을 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, [actorId, loadBoard, loadWorkspace]);

  useEffect(() => {
    if (selectedSrId === undefined) {
      detailQueries.current.issue({ actorId, projectId: __PLANREPO_PROJECT_ID__, target: 'no-sr-selected', methodId: 'M-047' });
      setDetail(undefined);
      setDetailError(undefined);
      return;
    }
    setDetail((previous) => previous?.sr.scope.srId === selectedSrId ? previous : undefined);
    void loadDetail(actorId, selectedSrId);
  }, [actorId, loadDetail, selectedSrId]);

  useEffect(() => {
    const restoreLocation = () => {
      const params = new URLSearchParams(location.search);
      const nextSrId = params.get('sr') ?? undefined;
      setDetail(previous => previous?.sr.scope.srId === nextSrId ? previous : undefined);
      setInitialTab(params.get('view') ?? undefined);
      setSelectedSrId(nextSrId);
      setRegistering(false);
    };
    window.addEventListener('popstate', restoreLocation);
    return () => window.removeEventListener('popstate', restoreLocation);
  }, []);
  const openSr = (srId: string, tab = 'documents') => {
    const url = new URL(location.href); url.searchParams.set('sr', srId); url.searchParams.set('view', tab);
    window.history.pushState(null, '', url);
    if (srId !== selectedSrId) setDetail(undefined);
    setInitialTab(tab); setSelectedSrId(srId); setRegistering(false);
  };
  const chooseScreen = (next: Screen) => {
    const url = new URL(location.href); url.searchParams.delete('sr'); url.searchParams.delete('view');
    window.history.pushState(null, '', url);
    setScreen(next); setSelectedSrId(undefined); setRegistering(false);
  };
  const actorName = (id: string) => workspace?.actors.find((actor) => actor.actorId === id)?.displayName ?? '알 수 없는 사용자';
  const switchActor = (nextActorId: string) => {
    if (nextActorId === actorId) return;
    workspaceQueries.current.issue({ actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__, target: 'workspace', methodId: 'M-001' });
    boardQueries.current.issue({ actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__, target: 'team-board', methodId: 'M-045' });
    detailQueries.current.issue({ actorId: nextActorId, projectId: __PLANREPO_PROJECT_ID__, target: 'no-sr-selected', methodId: 'M-047' });
    setWorkspace(undefined);
    setBoard(undefined);
    setBoardError(undefined);
    setDetailError(undefined);
    setLoadingBoard(true);
    setDetail(undefined);
    setLoadingDetail(selectedSrId !== undefined);
    setInitialTab(new URLSearchParams(location.search).get('view') ?? undefined);
    setActorId(nextActorId);
    setScreen('inbox');
    setRegistering(false);
  };


  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="PlanRepo 홈"><span className="brand-mark">P</span><span>PlanRepo</span></a>
        <div className="workspace-name"><small>프로젝트</small><strong>{workspace?.project.name ?? '불러오는 중'}</strong></div>
        <nav aria-label="주 메뉴">
          <button type="button" aria-current={screen === 'board' ? 'page' : undefined} onClick={() => chooseScreen('board')}>팀 보드</button>
          <button type="button" aria-current={screen === 'inbox' ? 'page' : undefined} onClick={() => chooseScreen('inbox')}>내 할 일</button>
          <button type="button" aria-current={screen === 'list' ? 'page' : undefined} onClick={() => chooseScreen('list')}>SR 목록</button>
          <button type="button" aria-current={screen === 'settings' ? 'page' : undefined} onClick={() => chooseScreen('settings')}>팀 설정</button>
        </nav>
        <div className="actor-picker">
          <label htmlFor="demo-actor">체험할 역할</label>
          <select id="demo-actor" value={actorId} onChange={(event) => switchActor(event.target.value)}>
            {(workspace?.actors ?? [{ actorId, displayName: '선택 사용자' }]).map((actor) => <option key={actor.actorId} value={actor.actorId}>{actor.displayName}</option>)}
          </select>
          <small>역할을 바꾸면 작성자와 검토자의 화면을 체험할 수 있습니다.</small>
        </div>
      </aside>
      <main className="content">
        <header className="topbar"><h1>PlanRepo</h1><span className={`connection ${workspace?.connection.available === true ? 'online' : ''}`}>{workspace?.connection.available === true ? '로컬 프로토타입' : '연결 확인 중'}</span></header>
        {error !== undefined && <div className="page-error" role="alert">{error}</div>}
        {boardError !== undefined && <div className="page-error" role="alert"><p>{boardError}</p><button type="button" onClick={() => { void loadBoard(actorId); }}>보드 다시 시도</button></div>}
        {selectedSrId !== undefined ? (
          <SRDetailShell actorId={actorId} projectId={__PLANREPO_PROJECT_ID__} detail={detail} loading={loadingDetail} {...(initialTab === undefined ? {} : { initialTab })} {...(detailError === undefined ? {} : { error: detailError })} members={workspace?.actors ?? []} policies={workspace?.policies ?? []} actorName={actorName} onBack={() => chooseScreen('board')} onRetry={() => { void loadDetail(actorId, selectedSrId); }} onRefresh={() => { void loadDetail(actorId, selectedSrId); void loadBoard(actorId); void loadWorkspace(actorId); }} />
        ) : registering ? (
          <SRRegistrationForm key={actorId} actorId={actorId} projectId={__PLANREPO_PROJECT_ID__} owners={workspace?.actors ?? []} onCancel={() => setRegistering(false)} onSaved={(srId) => { setRegistering(false); void loadBoard(actorId); openSr(srId, 'documents'); }} />
        ) : screen === 'board' ? (
          <TeamBoard actorId={actorId} projectId={__PLANREPO_PROJECT_ID__} board={board} loading={loadingBoard} actorName={actorName} onOpen={openSr} onRegister={() => setRegistering(true)} />
        ) : screen === 'list' ? (
          <SRList board={board} actorName={actorName} onOpen={openSr} onRegister={() => setRegistering(true)} />
        ) : screen === 'inbox' ? (
          <MyWork client={invoke} actorId={actorId} projectId={__PLANREPO_PROJECT_ID__} board={board} members={workspace?.actors ?? []} onOpen={openSr} />
        ) : workspace === undefined ? (
          <p role="status">팀 설정을 불러오고 있습니다.</p>
        ) : (
          <TeamPolicyEditor key={`${actorId}:${workspace.project.projectId}`} actorId={actorId} workspace={workspace} onSaved={() => { void loadWorkspace(actorId); }} />
        )}
      </main>
    </div>
  );
}
