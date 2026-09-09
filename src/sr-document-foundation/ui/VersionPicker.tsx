import { useNavigate } from 'react-router-dom';
import type { DocumentView, VersionSummary } from '../../shared/contracts.js';
import { versionRoute } from '../../shared/client/api-client.js';
export function VersionPicker({ view, versions }: { view: DocumentView; versions: VersionSummary[] }) {
  const navigate = useNavigate(); const all = versions.some(v => v.versionId === view.versionId) ? versions : [view, ...versions];
  return <label className="version-picker">열람 버전<select data-testid="version-picker-select" value={view.versionId} onChange={e => navigate(versionRoute({ ...view, versionId: e.target.value }))}>{all.map(v => <option key={v.versionId} value={v.versionId}>v{v.versionNumber} {v.isLatest ? '· 최신' : '· 과거'} · {v.title}</option>)}</select></label>;
}
