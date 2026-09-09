import { useMemo, useState } from 'react';
import type { BoardView } from '@/src/contracts/views';

export function SRList({ board, loading = false, actorName, onOpen, onRegister }: {
  readonly actorId?: string;
  readonly board: BoardView | undefined;
  readonly loading?: boolean;
  readonly actorName: (actorId: string) => string;
  onOpen(srId: string): void;
  onRegister(): void;
}) {
  const [query, setQuery] = useState('');
  const cards = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ko-KR');
    if (normalized === '') return board?.cards ?? [];
    return (board?.cards ?? []).filter(({ sr }) =>
      [sr.key, sr.title, actorName(sr.ownerId)].some((value) =>
        value.toLocaleLowerCase('ko-KR').includes(normalized)));
  }, [actorName, board?.cards, query]);
  return (
    <section aria-labelledby="sr-list-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">프로젝트 전체</p>
          <h2 id="sr-list-title">SR 목록</h2>
        </div>
        <button type="button" className="primary-button" onClick={onRegister}>SR 등록</button>
      </div>
      <label className="form-panel">
        등록한 요청 찾기
        <input type="search" value={query} placeholder="요청 키, 제목, 담당자로 찾기" onChange={(event) => setQuery(event.target.value)} />
        <small className="quiet">등록 원문은 SR을 열어 그대로 확인할 수 있습니다.</small>
      </label>
      <div className="table-wrap">
        <table>
          <thead><tr><th>등록한 요청</th><th>담당자</th><th><span className="sr-only">이동</span></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={3} role="status">등록 요청을 불러오고 있습니다.</td></tr>}
            {cards.map(({ sr }) => (
              <tr key={sr.scope.srId}>
                <td><p className="sr-key">{sr.key}</p><strong>{sr.title}</strong></td><td>{actorName(sr.ownerId)}</td>
                <td><button className="text-button" type="button" onClick={() => onOpen(sr.scope.srId)}>원문과 Plan 열기</button></td>
              </tr>
            ))}
            {!loading && cards.length === 0 && <tr><td colSpan={3} className="quiet">조건에 맞는 등록 요청이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
