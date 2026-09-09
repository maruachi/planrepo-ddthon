import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isSR } from '../../shared/client/api-client.js';
import { COLUMNS } from '../../shared/limits.js';
import { useQuery } from './use-query.js';
import { InitialInputPanel } from './InitialInputPanel.js';
import { DocumentList } from './DocumentList.js';
import { DocumentWorkspace } from './DocumentWorkspace.js';
import { HistoryPanel } from './HistoryPanel.js';
import { ErrorNotice } from './ErrorNotice.js';
import { AsyncStatus } from './AsyncStatus.js';
import { PlanningPanel } from '../../aidlc-planning/ui/PlanningPanel.js';
import { isWorkflow } from '../../aidlc-planning/ui/planning-client.js';
import { ReviewPanel } from '../../review-implementation/ui/ReviewPanel.js';
import { useRole } from '../../app/WorkspaceShell.js';
import { WorktreeSpikePanel } from '../../worktree-spike/ui/WorktreeSpikePanel.js';
export function SRDetailPage() {
  const { srId = '', documentId, versionId } = useParams();
  const [revision, setRevision] = useState(0); const query = useQuery(`/api/srs/${srId}`, isSR);
  const workflow = useQuery(`/api/srs/${srId}/workflow`, isWorkflow, revision); const sr = query.data; const role = useRole();
  const target = documentId && versionId ? { srId, documentId, versionId } : undefined;
  const changed = () => { setRevision(n => n + 1); query.reload(); };
  return <div className="detail-page">
    <nav className="breadcrumbs"><Link data-testid="detail-board-link" to="/">계획 보드</Link><span>/</span><span>SR {srId.slice(0, 8)}</span></nav>
    <ErrorNotice error={query.error} retry={query.reload} /><AsyncStatus loading={query.loading} />
    {sr && <>
      <div className="page-heading detail-heading"><div><p className="eyebrow">SERVICE REQUEST</p><h1>{sr.title}</h1><div className="subtitle"><span className="badge">{COLUMNS.find(([key]) => key === sr.column)?.[1]}</span><span>{role === 'author' ? '작성자' : '리뷰어'} · {new Date(sr.createdAt).toLocaleDateString('ko-KR')}</span></div></div></div>
      <WorktreeSpikePanel srId={srId} revision={revision} />
      <fieldset className="planning-role-scope" disabled={role === 'reviewer'} aria-label="작성자 계획 진행"><PlanningPanel key={role} srId={srId} revision={revision} changed={changed} /></fieldset>
      <ReviewPanel srId={srId} column={sr.column} target={target} role={role} revision={revision} workflowRevision={workflow.data?.revision ?? -1} changed={changed} />
      <ErrorNotice error={workflow.error} retry={workflow.reload} />
      <div className="detail-grid"><DocumentList srId={srId} selected={documentId} revision={revision} />
        <div className="detail-center">{target ? <DocumentWorkspace key={`${srId}:${documentId}:${versionId}:${role}`} target={target} revision={revision} changed={changed} readOnly={role === 'reviewer'} /> : <><InitialInputPanel sr={sr} /><section className="document-placeholder"><div className="placeholder-icon">▤</div><h2>계획을 이어갈 공간</h2><p>왼쪽 목록에서 문서를 선택하면<br/>본문과 버전별 변화를 확인할 수 있습니다.</p></section></>}
          {documentId && <details className="input-secondary"><summary>초기 요구사항 확인</summary><InitialInputPanel sr={sr} /></details>}
        </div>
        <HistoryPanel key={srId} srId={srId} documentId={documentId} revision={revision} />
      </div>
    </>}
  </div>;
}
