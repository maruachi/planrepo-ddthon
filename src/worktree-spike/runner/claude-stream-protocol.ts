import { StringDecoder } from 'node:string_decoder';
import { WORKTREE_TRANSCRIPT_BYTES, WORKTREE_TRANSCRIPT_ENTRIES, type WorktreeStreamEvent, type WorktreeTranscriptEntry, type WorktreeTranscriptRole } from '../contracts.js';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.flatMap(item => record(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : []).join('');
}

export function encodeClaudeUserMessage(text: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`;
}

export function decodeClaudeUserMessage(line: string): string {
  const value: unknown = JSON.parse(line);
  if (!record(value) || value.type !== 'user' || !record(value.message) || value.message.role !== 'user') throw new Error('Invalid Claude user message.');
  const text = textContent(value.message.content);
  if (!text) throw new Error('Invalid Claude user message.');
  return text;
}

export function normalizeClaudeEvent(value: unknown): WorktreeStreamEvent[] {
  if (!record(value) || typeof value.type !== 'string') throw new Error('Invalid Claude stream event.');
  const sessionId = typeof value.session_id === 'string' ? value.session_id : undefined;
  if (value.type === 'assistant' || value.type === 'user') {
    const message = record(value.message) ? value.message : undefined;
    const text = textContent(message?.content);
    if (!text) return [];
    return [{ role: value.type, text, sessionId }];
  }
  if (value.type === 'result') {
    const failed = value.is_error === true || (typeof value.subtype === 'string' && value.subtype !== 'success');
    const detail = failed ? (typeof value.error === 'string' ? value.error : typeof value.result === 'string' ? value.result : 'Claude 응답이 실패했습니다.') : 'Claude 응답이 완료되었습니다.';
    return [{ role: failed ? 'error' : 'status', text: detail, sessionId, turnComplete: true }];
  }
  if (value.type === 'system' && value.subtype === 'init') return [{ role: 'status', text: 'Claude 세션이 시작되었습니다.', sessionId }];
  return [];
}

export class ClaudeStreamDecoder {
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';

  push(chunk: Buffer | string): WorktreeStreamEvent[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    return this.drain(false);
  }

  finish(): WorktreeStreamEvent[] {
    this.buffer += this.decoder.end();
    return this.drain(true);
  }

  private drain(final: boolean): WorktreeStreamEvent[] {
    const lines = this.buffer.split('\n');
    this.buffer = final ? '' : lines.pop() ?? '';
    if (final && lines.at(-1) === '') lines.pop();
    const events: WorktreeStreamEvent[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      events.push(...normalizeClaudeEvent(JSON.parse(line)));
    }
    if (final && this.buffer.trim()) events.push(...normalizeClaudeEvent(JSON.parse(this.buffer.trim())));
    return events;
  }
}

export function appendTranscript(
  transcript: readonly WorktreeTranscriptEntry[],
  input: { role: WorktreeTranscriptRole; text: string; createdAt: string },
  maxEntries = WORKTREE_TRANSCRIPT_ENTRIES,
  maxBytes = WORKTREE_TRANSCRIPT_BYTES,
): WorktreeTranscriptEntry[] {
  if (!input.text.trim()) return [...transcript];
  const last = transcript.at(-1);
  if (last?.role === input.role && last.text === input.text) return [...transcript];
  const sequence = (last?.sequence ?? 0) + 1;
  const next = [...transcript, { sequence, ...input }];
  let bytes = next.reduce((total, entry) => total + Buffer.byteLength(entry.text, 'utf8'), 0);
  while (next.length > maxEntries || (bytes > maxBytes && next.length > 1)) {
    const removed = next.shift();
    if (removed) bytes -= Buffer.byteLength(removed.text, 'utf8');
  }
  return next;
}
