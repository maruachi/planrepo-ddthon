import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import { ApiClient } from '../../src/shared/client/api-client.js';
import type { SRSummary } from '../../src/shared/contracts.js';
import { BoardClient } from '../../src/sr-document-foundation/ui/board-client.js';
import { SRCard } from '../../src/sr-document-foundation/ui/SRCard.js';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const summary: SRSummary = { id: 'sr/id', title: '수동 이동', createdAt: '2026-09-09T00:00:00Z', column: 'sr_list' };

test('board client encodes the SR path and sends the stable operation contract', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = new BoardClient(new ApiClient(async (path, init) => { calls.push({ path: String(path), init }); return response({ ok: true, data: { ...summary, column: 'requirements_analysis' } }); }), () => 'generated-operation');
  await expect(client.move(summary.id, 'sr_list', 'requirements_analysis', 'stable-operation')).resolves.toMatchObject({ column: 'requirements_analysis' });
  expect(calls[0]?.path).toBe('/api/srs/sr%2Fid/board-movements');
  expect(calls[0]?.init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': 'stable-operation' } });
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ expectedColumn: 'sr_list', targetColumn: 'requirements_analysis' });
});

test('board client rejects malformed success and preserves API errors', async () => {
  const malformed = new BoardClient(new ApiClient(async () => response({ ok: true, data: { id: 'x' } })));
  await expect(malformed.move('x', 'sr_list', 'requirements_analysis')).rejects.toThrow('Malformed success');
  const rejected = new BoardClient(new ApiClient(async () => response({ ok: false, error: { code: 'WORKFLOW_CONFLICT', message: 'stale' } }, 409)));
  await expect(rejected.move('x', 'sr_list', 'requirements_analysis')).rejects.toMatchObject({ detail: { code: 'WORKFLOW_CONFLICT' } });
});

test('card renders sibling navigation and boundary-aware accessible buttons', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SRCard, { sr: summary, move: async () => {} })));
  expect(html).toContain('data-testid="sr-card-detail-link"');
  expect(html).toContain('aria-label="수동 이동 이전 상태로 이동"');
  expect(html).toContain('aria-label="수동 이동 다음 상태로 이동"');
  expect(html).toMatch(/sr-card-previous-button"[^>]*disabled/);
  expect(html).not.toMatch(/<a[^>]*>[^<]*(?:<[^/][^>]*>[^<]*)*<button/);
});
