import fc from 'fast-check';
import { expect, test } from 'vitest';
import type { WorktreeStreamEvent, WorktreeTranscriptEntry, WorktreeTranscriptRole } from '../../../src/worktree-spike/contracts.js';
import { appendTranscript, ClaudeStreamDecoder, decodeClaudeUserMessage, encodeClaudeUserMessage, normalizeClaudeEvent } from '../../../src/worktree-spike/runner/claude-stream-protocol.js';

const propertyOptions = { seed: 424242, numRuns: 150 };
const alphabet = ['a', 'Z', '0', ' ', '\n', '"', '\\', '가', '힣', 'é', '中', '🚀', '🙂'] as const;
const unicodeMessage = fc.array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 40 }).map(parts => parts.join('')).filter(value => !!value.trim());
const sessionId = fc.option(fc.uuid(), { nil: undefined });
const claudeEvent = fc.oneof(
  fc.record({ type: fc.constant('assistant'), message: fc.record({ content: fc.array(unicodeMessage.map(text => ({ type: 'text', text })), { minLength: 1, maxLength: 3 }) }), session_id: sessionId }),
  fc.record({ type: fc.constant('user'), message: fc.record({ content: fc.array(unicodeMessage.map(text => ({ type: 'text', text })), { minLength: 1, maxLength: 3 }) }), session_id: sessionId }),
  fc.record({ type: fc.constant('system'), subtype: fc.constant('init'), session_id: sessionId }),
  fc.record({ type: fc.constant('result'), subtype: fc.constant('success'), result: unicodeMessage, session_id: sessionId }),
);

test('PBT-02 Unicode user messages round-trip without text loss', () => {
  fc.assert(fc.property(unicodeMessage, message => {
    const encoded = encodeClaudeUserMessage(message);
    expect(encoded.endsWith('\n')).toBe(true);
    expect(decodeClaudeUserMessage(encoded)).toBe(message);
  }), propertyOptions);
});

test('PBT-02 arbitrary byte chunking reconstructs the same ordered Claude events', () => {
  fc.assert(fc.property(fc.array(claudeEvent, { minLength: 1, maxLength: 15 }), fc.array(fc.integer({ min: 1, max: 31 }), { minLength: 1, maxLength: 20 }), (events, chunkSizes) => {
    const bytes = Buffer.from(`${events.map(event => JSON.stringify(event)).join('\n')}\n`);
    const decoder = new ClaudeStreamDecoder();
    const actual: WorktreeStreamEvent[] = [];
    let offset = 0; let chunk = 0;
    while (offset < bytes.length) {
      const size = chunkSizes[chunk % chunkSizes.length];
      actual.push(...decoder.push(bytes.subarray(offset, offset + size)));
      offset += size; chunk++;
    }
    actual.push(...decoder.finish());
    expect(actual).toEqual(events.flatMap(normalizeClaudeEvent));
  }), propertyOptions);
});

test('PBT-03 SR-local transcripts preserve monotonic order, bounds, and duplicate suppression', () => {
  const role = fc.constantFrom<WorktreeTranscriptRole>('user', 'assistant', 'status', 'error');
  const input = fc.record({ sr: fc.constantFrom('sr-a', 'sr-b'), role, text: unicodeMessage.map(value => Array.from(value).slice(0, 12).join('')) });
  fc.assert(fc.property(fc.array(input, { minLength: 1, maxLength: 100 }), inputs => {
    const transcripts = new Map<string, WorktreeTranscriptEntry[]>([['sr-a', []], ['sr-b', []]]);
    for (const [index, item] of inputs.entries()) {
      const previous = transcripts.get(item.sr)!;
      const next = appendTranscript(previous, { role: item.role, text: item.text, createdAt: new Date(index).toISOString() }, 12, 256);
      transcripts.set(item.sr, next);
    }
    for (const transcript of transcripts.values()) {
      expect(transcript.length).toBeLessThanOrEqual(12);
      expect(transcript.reduce((bytes, entry) => bytes + Buffer.byteLength(entry.text, 'utf8'), 0)).toBeLessThanOrEqual(256);
      expect(transcript.every((entry, index) => index === 0 || transcript[index - 1].sequence < entry.sequence)).toBe(true);
      const last = transcript.at(-1);
      if (last) expect(appendTranscript(transcript, { role: last.role, text: last.text, createdAt: new Date().toISOString() }, 12, 256)).toEqual(transcript);
    }
  }), propertyOptions);
});
