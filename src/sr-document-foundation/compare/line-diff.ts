import { diffLines } from 'diff';
import type { DiffContent, DiffInput } from './diff-contracts.js';
export function lineCount(s: string): number { if (!s) return 0; let count = s.endsWith('\n') ? 0 : 1; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) count++; return count; }
export function compareLines(input: DiffInput, options = { timeout: 250, maxEditLength: 2000, maxLines: 20000, maxBlocks: 20000 }): DiffContent {
  const { left, right } = input; const titleChanged = left.title !== right.title; const unchanged = !titleChanged && left.body === right.body;
  if (left.body === right.body) return { mode: 'detailed', titleChanged, unchanged, blocks: left.body ? [{ kind: 'equal', text: left.body, count: lineCount(left.body) }] : [] };
  const overLines = lineCount(left.body) + lineCount(right.body) > options.maxLines;
  const changes = overLines ? undefined : diffLines(left.body, right.body, { ignoreWhitespace: false, ignoreNewlineAtEof: false, stripTrailingCr: false, newlineIsToken: false, timeout: options.timeout, maxEditLength: options.maxEditLength });
  if (!changes || changes.length > options.maxBlocks) return { mode: 'coarse', reason: overLines ? '줄 수 상한을 넘어 양쪽 원문 전체를 표시합니다.' : '상세 계산 한도를 넘어 양쪽 원문 전체를 표시합니다.', titleChanged, unchanged, blocks: [...(left.body ? [{ kind: 'remove' as const, text: left.body, count: lineCount(left.body) }] : []), ...(right.body ? [{ kind: 'add' as const, text: right.body, count: lineCount(right.body) }] : [])] };
  return { mode: 'detailed', titleChanged, unchanged, blocks: changes.map(c => ({ kind: c.added ? 'add' : c.removed ? 'remove' : 'equal', text: c.value, count: lineCount(c.value) })) };
}
