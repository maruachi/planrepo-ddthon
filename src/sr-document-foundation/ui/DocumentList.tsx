import { Link } from 'react-router-dom';
import type { DocumentSummary } from '../../shared/contracts.js';
import { isRef, record, versionRoute } from '../../shared/client/api-client.js';
import { usePaged } from './use-query.js';
import { Pagination } from './Pagination.js';
import { ErrorNotice } from './ErrorNotice.js';
import { AsyncStatus } from './AsyncStatus.js';
export const isDocumentSummary = (x: unknown): x is DocumentSummary => isRef(x) && record(x) && isRef(x.latestVersionRef) && typeof x.title === 'string' && typeof x.versionNumber === 'number';
export function DocumentList({ srId, selected, revision }: { srId: string; selected?: string; revision: number }) {
  const query = usePaged(`/api/srs/${srId}/documents`, isDocumentSummary, revision);
  return <aside className="document-list"><h2>계획 문서 <span>{query.data?.items.length ?? 0}</span></h2><ErrorNotice error={query.error} retry={query.reload} /><AsyncStatus loading={query.loading} />{query.data?.items.map(d => <Link className={`document-item ${selected === d.documentId ? 'selected' : ''}`} aria-current={selected === d.documentId ? 'page' : undefined} key={d.documentId} data-testid="document-list-version-link" to={versionRoute(d.latestVersionRef)}><span className="doc-icon" aria-hidden="true">▤</span><span><strong>{d.title}</strong><small>v{d.versionNumber} · {d.origin === 'ai_generated' ? 'AI 생성' : d.origin === 'restoration' ? '복원' : '사람 편집'}</small></span></Link>)}{query.data && !query.data.items.length && <p className="empty">아직 생성된 계획 문서가 없습니다.</p>}{query.data && <Pagination count={query.data.items.length} hasMore={!!query.data.nextCursor} loading={query.loading} more={() => void query.more()} />}</aside>;
}
