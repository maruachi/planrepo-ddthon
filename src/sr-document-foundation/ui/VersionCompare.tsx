import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppError, DocumentView, VersionSummary } from '../../shared/contracts.js';
import type { DiffView } from '../compare/diff-contracts.js';
import { api, isRef, record, versionRoute } from '../../shared/client/api-client.js';
import { errorOf } from '../../shared/errors.js';
import { CompareGeneration, textPage } from './compare-state.js';
import { ErrorNotice } from './ErrorNotice.js';
const isDiff = (x: unknown): x is DiffView => record(x) && isRef(x.left) && isRef(x.right) && ['coarse', 'detailed'].includes(String(x.mode)) && Array.isArray(x.blocks) && x.blocks.every(b => record(b) && typeof b.text === 'string' && typeof b.count === 'number' && ['equal', 'add', 'remove'].includes(String(b.kind)));
export function VersionCompare({ view, versions }: { view: DocumentView; versions: VersionSummary[] }) {
  const [left, setLeft] = useState(view.versionId); const [right, setRight] = useState(view.latestVersionRef.versionId); const [data, setData] = useState<DiffView>(); const [error, setError] = useState<AppError>(); const [loading, setLoading] = useState(false); const [page, setPage] = useState(0); const generation = useRef(new CompareGeneration()); const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current.next(); abort.current?.abort(); }, []);
  const invalidate = () => { generation.current.next(); abort.current?.abort(); setLoading(false); setData(undefined); setError(undefined); setPage(0); };
  const run = async () => { const g = generation.current.next(); abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setLoading(true); setError(undefined); setData(undefined); setPage(0);
    try { const result = await api.request(`/api/srs/${view.srId}/documents/${view.documentId}/compare?left=${left}&right=${right}`, isDiff, { signal: controller.signal }); if (generation.current.accepts(g)) setData(result); }
    catch (e) { if (generation.current.accepts(g)) setError(errorOf(e, 'COMPARE_FAILED')); } finally { if (generation.current.accepts(g)) setLoading(false); }
  };
  const all = versions.some(v => v.versionId === view.versionId) ? versions : [view, ...versions];
  const display = useMemo(() => {
    let offset = 0, leftLine = 1, rightLine = 1; const rows: { key: number; left?: number; right?: number; kind: string; text: string; ending: string }[] = [];
    for (const b of data?.blocks ?? []) {
      const start = Math.max(0, page * 200 - offset); const count = Math.min(b.count - start, (page + 1) * 200 - offset - start);
      if (count > 0) for (const line of textPage(b.text, start / 200).lines.slice(0, count)) rows.push({ key: offset + line.number, left: b.kind === 'add' ? undefined : leftLine + line.number - 1, right: b.kind === 'remove' ? undefined : rightLine + line.number - 1, kind: b.kind, text: line.text, ending: line.ending });
      offset += b.count; if (b.kind !== 'add') leftLine += b.count; if (b.kind !== 'remove') rightLine += b.count;
    } return { rows, total: offset };
  }, [data, page]);
  return <section className="compare"><h3>버전 비교</h3><div className="compare-controls"><label>왼쪽 · 이전<select data-testid="compare-left-select" value={left} onChange={e => { invalidate(); setLeft(e.target.value); }}>{all.map(v => <option key={v.versionId} value={v.versionId}>v{v.versionNumber} · {v.title}</option>)}</select></label><span aria-hidden="true">→</span><label>오른쪽 · 이후<select data-testid="compare-right-select" value={right} onChange={e => { invalidate(); setRight(e.target.value); }}>{all.map(v => <option key={v.versionId} value={v.versionId}>v{v.versionNumber} · {v.title}</option>)}</select></label><button className="primary" data-testid="compare-submit-button" disabled={loading} onClick={() => void run()}>{loading ? '비교 중…' : '비교하기'}</button></div><ErrorNotice error={error} />{data && <><div className="compare-summary"><Link data-testid="compare-left-link" to={versionRoute(data.left)}>왼쪽 v{data.left.versionNumber}</Link><span>→</span><Link data-testid="compare-right-link" to={versionRoute(data.right)}>오른쪽 v{data.right.versionNumber}</Link><span>{data.unchanged ? '변경 없음' : data.mode === 'coarse' ? '간략 비교' : '상세 비교'}</span></div>{data.reason && <p className="notice">{data.reason}</p>}{data.titleChanged && <p>제목 변경: {data.left.title} → {data.right.title}</p>}<div className="diff-scroll" tabIndex={0} aria-label="버전 차이"><pre>{display.rows.map(r => <div key={r.key} className={`diff-line ${r.kind}`}><span>{r.left ?? ''}</span><span>{r.right ?? ''}</span><b>{r.kind === 'add' ? '+' : r.kind === 'remove' ? '−' : ' '}</b><code>{r.text}</code><small>{r.ending === '끝 개행 없음' ? ' ∅ 끝 개행 없음' : ` ↵ ${r.ending}`}</small></div>)}</pre></div><div className="text-tools"><span>{display.total.toLocaleString()}줄 중 {display.rows.length}줄 · {page + 1}/{Math.max(1, Math.ceil(display.total / 200))} 구간</span><button data-testid="compare-previous-button" disabled={!page} onClick={() => setPage(p => p - 1)}>이전</button><button data-testid="compare-next-button" disabled={(page + 1) * 200 >= display.total} onClick={() => setPage(p => p + 1)}>다음</button></div></>}</section>;
}
