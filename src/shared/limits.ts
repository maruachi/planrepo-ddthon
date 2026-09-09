export const LIMITS = { title: 4096, text: 1048576, json: 16777216, cursor: 1024, page: 50, maxPage: 100, renderBytes: 262144, renderLines: 5000, displayLines: 200 } as const;
export const COLUMNS = [
  ['sr_list', 'SR 목록'], ['requirements_analysis', '요구사항 분석'],
  ['inception', 'Inception'], ['construction', 'Construction'],
  ['peer_review', '피어 리뷰'], ['implementation_ready', '구현 대기'], ['implemented', '구현 완료'],
] as const;
export type Column = typeof COLUMNS[number][0];
export type BoardMoveDirection = 'previous' | 'next';
export function adjacentColumn(column: Column, direction: BoardMoveDirection): Column | undefined {
  const index = COLUMNS.findIndex(([key]) => key === column);
  const adjacent = direction === 'previous' ? index - 1 : index + 1;
  return COLUMNS[adjacent]?.[0];
}
