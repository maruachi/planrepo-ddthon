import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DocumentView, VersionRef, VersionSummary } from '../../shared/contracts.js';
import { isDocument, isRef, record, versionRoute, versionURL } from '../../shared/client/api-client.js';
import { usePaged, useQuery } from './use-query.js';
import { VersionPicker } from './VersionPicker.js';
import { DocumentReader } from './DocumentReader.js';
import { DocumentEditor } from './DocumentEditor.js';
import { VersionCompare } from './VersionCompare.js';
import { RestoreConfirm } from './RestoreConfirm.js';
import { ErrorNotice } from './ErrorNotice.js';
import { AsyncStatus } from './AsyncStatus.js';
import { Pagination } from './Pagination.js';
const isVersion = (x: unknown): x is VersionSummary => isRef(x) && record(x) && typeof x.title === 'string' && typeof x.versionNumber === 'number' && typeof x.isLatest === 'boolean';
export function DocumentWorkspace({ target, revision, changed, readOnly = false }: { target: VersionRef; revision: number; changed: () => void; readOnly?: boolean }) {
  const query = useQuery(versionURL(target), isDocument, revision); const versions = usePaged(`/api/srs/${target.srId}/documents/${target.documentId}/versions`, isVersion, revision); const [editing, setEditing] = useState(false); const [compare, setCompare] = useState(false); const [restore, setRestore] = useState(false); const [message, setMessage] = useState(''); const [conflictRef, setConflictRef] = useState<VersionRef>(); const navigate = useNavigate();
  const saved = (v: DocumentView, didChange: boolean) => { setEditing(false); setRestore(false); setMessage(didChange ? '새 버전을 저장했습니다.' : '변경된 내용이 없습니다.'); changed(); navigate(versionRoute(v)); };
  const view = query.data;
  return <section className="document-workspace"><ErrorNotice error={query.error} retry={query.reload} /><AsyncStatus loading={query.loading} />{view && <><div className="document-heading"><div><p className="eyebrow">PLAN DOCUMENT</p><h2>{view.title}</h2><div className="version-meta"><span className={`badge ${view.isLatest ? 'success' : ''}`}>{view.isLatest ? '최신 버전' : '과거 버전'} · v{view.versionNumber}</span><span>{view.origin === 'ai_generated' ? 'AI 생성' : view.origin === 'restoration' ? '복원' : '사람 편집'}</span><time>{new Date(view.createdAt).toLocaleString('ko-KR')}</time></div></div><VersionPicker view={view} versions={versions.data?.items ?? []} /></div>{!view.isLatest && <p className="notice">과거 내용을 보고 있습니다. <Link data-testid="document-latest-link" to={versionRoute(view.latestVersionRef)}>최신 버전 열기</Link></p>}<ErrorNotice error={versions.error} retry={versions.reload} />{versions.data?.nextCursor && <Pagination count={versions.data.items.length} hasMore loading={versions.loading} more={() => void versions.more()} />}<div className="document-actions"><button data-testid="document-edit-button" disabled={readOnly || !view.isLatest || editing} onClick={() => { setEditing(true); setMessage(''); }}>✎ 본문 편집</button><button data-testid="document-compare-button" aria-expanded={compare} onClick={() => setCompare(v => !v)}>⇄ 버전 비교</button><button data-testid="document-restore-button" disabled={readOnly || editing} onClick={() => setRestore(true)}>↶ 이 버전 복원</button></div>{message && <p role="status" className="notice">{message}</p>}{editing ? <DocumentEditor view={view} onConflict={ref => { setConflictRef(ref); versions.reload(); setCompare(true); }} saved={saved} cancel={() => setEditing(false)} /> : <DocumentReader key={view.versionId} view={view} />}{compare && <VersionCompare key={conflictRef?.versionId ?? view.versionId} view={conflictRef ? { ...view, latestVersionRef: conflictRef } : view} versions={versions.data?.items ?? []} />}{restore && <RestoreConfirm view={view} saved={saved} cancel={() => setRestore(false)} />}</>}</section>;
}
