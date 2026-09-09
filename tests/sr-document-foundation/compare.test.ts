import { expect, test } from 'vitest';
import { compareLines } from '../../src/sr-document-foundation/compare/line-diff.js';
test('both originals reconstruct exactly including CRLF, whitespace and final newline', () => {
  for (const [a, b] of [['', ''], ['', 'x'], ['a\r\n b\n', 'a\n b'], ['x\nx\ny\n', 'y\nx\nx'], ['a\n', 'a'], [' '.repeat(1024), '\n'.repeat(21000)]]) {
    const result = compareLines({ left: { title: 'a', body: a }, right: { title: 'b', body: b } });
    expect(result.blocks.filter(c => c.kind !== 'add').map(c => c.text).join('')).toBe(a);
    expect(result.blocks.filter(c => c.kind !== 'remove').map(c => c.text).join('')).toBe(b);
    expect(result.titleChanged).toBe(true); expect(result.unchanged).toBe(false);
  }
});
test('bounded diff falls back completely and deterministically', () => {
  const input = { left: { title: 'a', body: 'a\nb\nc\n' }, right: { title: 'a', body: 'd\ne\nf\n' } };
  const result = compareLines(input, { timeout: 250, maxEditLength: 1, maxLines: 20000, maxBlocks: 20000 });
  expect(result.mode).toBe('coarse'); expect(result.blocks.map(b => b.text)).toEqual([input.left.body, input.right.body]);
  expect(compareLines(input)).toEqual(compareLines(input));
});
