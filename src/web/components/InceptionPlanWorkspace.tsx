import { useEffect, useRef, useState } from 'react';
import type { RevisionOrAbsentGuard } from '@/src/contracts/context';
import type { ArtifactEdit, ArtifactView, DemoActorView, PolicyView, SRDetailView } from '@/src/contracts/views';
import { invoke, TransportUncertainError } from '../api/client';
import { currentPlan, documentSection, isInceptionPlan, planStateLabel, type InceptionDocumentId } from '../state/inception-plan';
import { deriveDraftDocumentStructure } from '../state/draft-document';
import { editablePlanMarkdown, preservePlanVisualization } from '../state/plan-visualization';
import { DecisionPanel } from './DecisionPanel';
import { InceptionConversation } from './InceptionConversation';
import { PlanOverview } from './PlanOverview';
import { PlanDocumentReview } from './PlanDocumentReview';
import { PlanApproval } from './PlanApproval';
import { SRReviewAssignment } from './SRReviewAssignment';
import { SRContextPanel } from './SRContextPanel';
import { SafeMarkdown } from './SafeMarkdown';
import type { PlanReadinessIssue } from '../state/plan-review-readiness';
import './InceptionPlanWorkspace.css';

type View = 'documents' | 'overview' | 'approval';
const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'documents', label: '문서' },
  { id: 'overview', label: '요약·시각화' },
  { id: 'approval', label: '공유·리뷰' },
];

function viewFrom(value?: string): View {
  if (value === 'review' || value === 'review-g1' || value === 'assignment' || value === 'approval') return 'approval';
  if (value === 'overview') return 'overview';
  return 'documents';
}

function SimplePlanEditor({ actorId, projectId, detail, artifact, onClose, onSaved }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly artifact?: ArtifactView;
  onClose(): void;
  onSaved(): void;
}) {
  const initialText = artifact === undefined ? detail.currentDescription.description : editablePlanMarkdown(artifact.markdown);
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const mounted = useRef(true);
  const attempt = useRef<{ readonly key: string; readonly input: ArtifactEdit; readonly guard: RevisionOrAbsentGuard<'artifact'>; readonly markdown: string } | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const save = async () => {
    if (pending) return;
    const visibleMarkdown = text;
    if (visibleMarkdown.trim() === '') {
      setError('문서 내용을 입력해 주세요.');
      return;
    }
    const markdown = preservePlanVisualization(visibleMarkdown, artifact?.markdown);
    if (new TextEncoder().encode(markdown).byteLength > 1024 * 1024) {
      setError('문서는 UTF-8 기준 1 MiB 이하로 저장할 수 있습니다.');
      return;
    }
    if (attempt.current === undefined || attempt.current.markdown !== markdown) {
      const srId = detail.sr.scope.srId;
      attempt.current = {
        key: crypto.randomUUID(),
        markdown,
        input: {
          kind: 'requirements',
          ...(artifact === undefined ? {} : { artifactId: artifact.artifactId }),
          markdown,
          ...deriveDraftDocumentStructure(markdown),
          changeSummary: '문서를 수정했습니다.',
          targetBasis: artifact === undefined
            ? { kind: 'absent', logicalKey: 'requirements' }
            : { kind: 'version', ref: artifact.versionRef },
          sourceRefs: artifact?.sourceRefs ?? detail.sources.map((source) => source.currentVersionRef),
          decisionRefs: artifact?.decisionRefs ?? [],
          questionResultRefs: artifact?.questionResultRefs ?? [],
        },
        guard: artifact === undefined
          ? { resource: { target: { kind: 'artifact_logical_key', projectId, srId, logicalKey: 'requirements' }, expected: 'absent' } }
          : { resource: { target: { kind: 'artifact', projectId, srId, entityId: artifact.artifactId }, expectedRevision: artifact.revision } },
      };
    }
    const frozen = attempt.current;
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await invoke('M-015', {
        actorId,
        projectId,
        srId: detail.sr.scope.srId,
        idempotencyKey: frozen.key,
        guard: frozen.guard,
      }, frozen.input);
      if (!mounted.current) return;
      if (!result.ok) {
        if (result.error.code !== 'STORE_UNAVAILABLE') attempt.current = undefined;
        setError(result.error.message);
        return;
      }
      attempt.current = undefined;
      setMessage('문서를 저장했습니다.');
      onSaved();
      onClose();
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason instanceof TransportUncertainError
        ? '저장 결과를 확인하지 못했습니다. 다시 누르면 같은 요청을 확인합니다.'
        : reason instanceof Error ? reason.message : '문서를 저장하지 못했습니다.');
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return <section className="simple-plan-editor" aria-label="Plan 문서 편집">
    <label>문서 내용<textarea rows={24} value={text} disabled={pending} onChange={(event) => { setText(event.target.value); setError(undefined); setMessage(undefined); }} /></label>
    <p className="quiet">제목과 문단 구조는 저장할 때 자동으로 정리합니다. 입력한 본문은 그대로 보존합니다.</p>
    <div className="draft-actions">
      <button type="button" className="primary-button" disabled={pending} onClick={() => { void save(); }}>{pending ? '저장 중…' : '문서 저장'}</button>
      {artifact !== undefined && <button type="button" disabled={pending} onClick={onClose}>취소</button>}
    </div>
    {message !== undefined && <p className="success-note" role="status">{message}</p>}
    {error !== undefined && <p className="page-error" role="alert">{error}</p>}
  </section>;
}

export function InceptionPlanWorkspace({ actorId, projectId, detail, members, policies, actorName, initialTab, onRefresh }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView;
  readonly members: readonly DemoActorView[];
  readonly policies: readonly PolicyView[];
  readonly actorName: (actorId: string) => string;
  readonly initialTab?: string;
  onRefresh(): void;
}) {
  const [view, setView] = useState<View>(() => viewFrom(initialTab));
  const [aiOpen, setAiOpen] = useState(() => initialTab === 'conversation' || initialTab === 'questions' || initialTab === 'drafts');
  const [editing, setEditing] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const artifact = currentPlan(detail);
  const owner = actorId === detail.sr.ownerId;
  const plan = isInceptionPlan(artifact);
  const assignedReviewerCount = detail.reviewConfigurations.find((item) => item.gate === 'G1')?.assignment?.reviewerIds.length ?? 0;

  useEffect(() => {
    setView(viewFrom(initialTab));
    if (initialTab === 'conversation' || initialTab === 'questions' || initialTab === 'drafts') setAiOpen(true);
  }, [initialTab]);
  useEffect(() => {
    if (artifact?.sectionIndex.some((section) => section.sectionId === selectedSectionId) !== true) {
      setSelectedSectionId(artifact?.sectionIndex[0]?.sectionId);
    }
  }, [artifact, selectedSectionId]);

  const chooseView = (next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set('sr', detail.sr.scope.srId);
    url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
  };
  const openDocument = (id: InceptionDocumentId = 'requirements') => {
    const section = documentSection(artifact, id);
    if (section !== undefined) setSelectedSectionId(section.sectionId);
    setEditing(false);
    chooseView('documents');
    if (section !== undefined) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const heading = [...document.querySelectorAll<HTMLElement>('.plan-document-body h2')]
          .find((item) => item.textContent?.trim() === section.title.trim());
        heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
    }
  };
  const focusAfterNavigation = (id: string) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const element = document.getElementById(id);
      if (element instanceof HTMLDetailsElement) element.open = true;
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  };
  const resolveReviewIssue = (issue: PlanReadinessIssue) => {
    if (issue.action === 'assignment') {
      chooseView('approval');
      focusAfterNavigation('inception-review-assignment');
      return;
    }
    if (issue.targetId !== undefined) setSelectedSectionId(issue.targetId);
    chooseView('documents');
    focusAfterNavigation('inception-plan-documents');
  };
  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('sr', detail.sr.scope.srId);
    url.searchParams.set('view', 'documents');
    try {
      await navigator.clipboard.writeText(url.toString());
      setMessage('문서 링크를 복사했습니다. 같은 플랫폼에 접속한 동료에게 공유할 수 있습니다.');
    } catch {
      setMessage('공유 링크: ' + url.toString());
    }
  };
  const download = () => {
    if (artifact === undefined) return;
    const body = '# ' + detail.sr.title + '\n\nSR: ' + detail.sr.key + '\n\n문서 버전: ' + artifact.versionRef.version + '\n\n현재 상태: ' + planStateLabel(detail) + '\n\n---\n\n' + artifact.markdown;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = detail.sr.key.replace(/[^a-zA-Z0-9가-힣_-]/gu, '-') + '-plan-v' + artifact.versionRef.version + '.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return <div className="inception-workspace">
    <div className="plan-toolbar"><p>문서를 작성하고 동료와 함께 검토합니다. AI 정리는 필요할 때만 사용할 수 있습니다.</p><div><button onClick={() => { void share(); }}>링크 복사</button>{artifact !== undefined && <button onClick={download}>문서 다운로드</button>}</div></div>
    {message !== undefined && <p className="plan-feedback" role="status">{message}</p>}
    <nav className="plan-main-tabs" aria-label="Plan 작업">{VIEWS.map((item) => <button key={item.id} aria-current={view === item.id ? 'page' : undefined} onClick={() => chooseView(item.id)}>{item.label}</button>)}</nav>

    <div hidden={view !== 'documents'} id="inception-plan-documents" tabIndex={-1} className="plan-document-content">
      <header className="plan-document-heading"><div><p className="eyebrow">Plan 문서</p><h2>{detail.sr.title}</h2><p>{artifact === undefined ? '등록한 내용을 문서로 저장해 공유할 수 있습니다.' : `문서 v${artifact.versionRef.version} · ${artifact.authorOrigin === 'human' ? '사람이 작성' : 'AI 초안을 사람이 적용'}`}</p></div>{owner && artifact !== undefined && <button type="button" onClick={() => setEditing((value) => !value)}>{editing ? '본문으로 돌아가기' : '문서 편집'}</button>}</header>
      {editing || artifact === undefined
        ? owner
          ? <SimplePlanEditor key={`${artifact?.artifactId ?? 'new'}:${artifact?.versionRef.version ?? 0}`} actorId={actorId} projectId={projectId} detail={detail} {...(artifact === undefined ? {} : { artifact })} onClose={() => setEditing(false)} onSaved={onRefresh} />
          : <section className="plan-empty-guide"><p>담당자가 등록한 내용을 문서로 저장하면 여기에서 읽고 검토할 수 있습니다.</p></section>
        : <section className="plan-document-body"><SafeMarkdown>{artifact.markdown}</SafeMarkdown></section>}

      {artifact !== undefined && !editing && artifact.sectionIndex.length > 0 && <details className="workspace-details plan-section-review"><summary>문단별 의견 남기기</summary>
        <label>검토할 문단<select value={selectedSectionId ?? ''} onChange={(event) => setSelectedSectionId(event.target.value)}>{artifact.sectionIndex.map((section) => <option key={section.sectionId} value={section.sectionId}>{section.title}</option>)}</select></label>
        {selectedSectionId !== undefined && <PlanDocumentReview actorId={actorId} projectId={projectId} detail={detail} artifact={artifact} selectedSectionId={selectedSectionId} actorName={actorName} onSaved={onRefresh} />}
      </details>}

      <details className="workspace-details" open={aiOpen} onToggle={(event) => setAiOpen(event.currentTarget.open)}>
        <summary>AI로 문서 정리하기 <span className="quiet">(선택)</span></summary>
        <p className="quiet">문서는 직접 작성할 수 있습니다. 질문과 제안은 필요할 때만 열어 확인합니다.</p>
        <div className="plan-conversation-layout"><div><InceptionConversation actorId={actorId} projectId={projectId} detail={detail} actorName={actorName} onSaved={onRefresh} onOpenDocument={() => openDocument()} />
          {detail.decisions.length > 0 && <details id="inception-decisions" tabIndex={-1} className="workspace-details"><summary>참고 결정 {detail.decisions.length}개</summary><DecisionPanel actorId={actorId} projectId={projectId} detail={detail} members={members} actorName={actorName} onSaved={onRefresh} /></details>}
        </div></div>
      </details>
      <details className="workspace-details"><summary>등록 원문과 참고 자료</summary><SRContextPanel actorId={actorId} projectId={projectId} detail={detail} actorName={actorName} onSaved={onRefresh} /></details>
      {detail.artifacts.some((item) => item.kind !== 'requirements') && <details className="workspace-details"><summary>기존 개별 문서</summary>{detail.artifacts.filter((item) => item.kind !== 'requirements').map((item) => <section className="legacy-plan-document" key={item.artifactId}><h3>{item.sectionIndex[0]?.title ?? item.changeSummary}</h3><SafeMarkdown>{item.markdown}</SafeMarkdown></section>)}</details>}
    </div>

    <div hidden={view !== 'overview'}><PlanOverview detail={detail} actorName={actorName} onOpenDocument={openDocument} onDiscuss={() => { setAiOpen(true); chooseView('documents'); }} onReview={() => chooseView('approval')} /></div>

    <div hidden={view !== 'approval'}>
      <section className="plan-sharing"><h2>{plan ? '문서를 함께 검토합니다' : '문서를 먼저 준비합니다'}</h2><p>{plan ? '현재 문서를 공유하고 지정한 검토자의 승인을 받을 수 있습니다.' : '문서에 내용을 저장한 뒤 검토자에게 요청할 수 있습니다.'}</p><button onClick={() => { void share(); }}>문서 링크 복사</button>{artifact !== undefined && <button onClick={download}>문서 다운로드</button>}</section>
      <details id="inception-review-assignment" tabIndex={-1} open={assignedReviewerCount === 0} className="workspace-details"><summary>검토자 {assignedReviewerCount}명 · 배정 확인/변경</summary><SRReviewAssignment actorId={actorId} projectId={projectId} detail={detail} members={members} policies={policies} inceptionOnly onSaved={onRefresh} /></details>
      <PlanApproval actorId={actorId} projectId={projectId} detail={detail} actorName={actorName} onResolveIssue={resolveReviewIssue} onSaved={onRefresh} />
    </div>
  </div>;
}
