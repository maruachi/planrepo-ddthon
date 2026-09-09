import { expect, test } from 'vitest';
import { appendTranscript, ClaudeStreamDecoder, decodeClaudeUserMessage, encodeClaudeUserMessage, normalizeClaudeEvent } from '../../../src/worktree-spike/runner/claude-stream-protocol.js';

test('encodes and decodes a Unicode user message as one JSONL record', () => {
  const encoded = encodeClaudeUserMessage('진행해줘 🚀');
  expect(encoded.endsWith('\n')).toBe(true);
  expect(decodeClaudeUserMessage(encoded)).toBe('진행해줘 🚀');
});

test('decodes fragmented UTF-8 and multiple Claude events in order', () => {
  const decoder = new ClaudeStreamDecoder();
  const stream = `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-1' })}\n${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '승인할까요?' }] }, session_id: 'session-1' })}\n`;
  const bytes = Buffer.from(stream);
  expect(decoder.push(bytes.subarray(0, bytes.length - 2))).toEqual([{ role: 'status', text: 'Claude 세션이 시작되었습니다.', sessionId: 'session-1' }]);
  expect(decoder.push(bytes.subarray(bytes.length - 2))).toEqual([{ role: 'assistant', text: '승인할까요?', sessionId: 'session-1' }]);
  expect(decoder.finish()).toEqual([]);
});

test('normalizes a completed turn and rejects malformed events', () => {
  expect(normalizeClaudeEvent({ type: 'result', subtype: 'success', result: '완료', session_id: 's' })).toEqual([{ role: 'status', text: 'Claude 응답이 완료되었습니다.', sessionId: 's', turnComplete: true }]);
  expect(() => normalizeClaudeEvent({ nope: true })).toThrow('Invalid Claude stream event');
  expect(() => new ClaudeStreamDecoder().push('{bad}\n')).toThrow();
});

test('appends monotonic entries, suppresses exact duplicates, and evicts oldest entries', () => {
  const first = appendTranscript([], { role: 'assistant', text: 'one', createdAt: '2026-09-09T00:00:00.000Z' }, 2, 100);
  const duplicate = appendTranscript(first, { role: 'assistant', text: 'one', createdAt: '2026-09-09T00:00:01.000Z' }, 2, 100);
  const second = appendTranscript(duplicate, { role: 'user', text: 'two', createdAt: '2026-09-09T00:00:02.000Z' }, 2, 100);
  const third = appendTranscript(second, { role: 'assistant', text: 'three', createdAt: '2026-09-09T00:00:03.000Z' }, 2, 100);
  expect(third.map(entry => [entry.sequence, entry.text])).toEqual([[2, 'two'], [3, 'three']]);
});
