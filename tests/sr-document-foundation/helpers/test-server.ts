import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { services } from './test-db.js';
import { LocalAppBoundary } from '../../../src/sr-document-foundation/http/boundary.js';
import { routes } from '../../../src/sr-document-foundation/http/routes.js';
export async function testServer(dropOnce = false) {
  const t = services(); const boundary = new LocalAppBoundary(t.sr, t.docs, t.store); const app = express();
  if (dropOnce) app.use((_req, res, next) => { const json = res.json.bind(res); res.json = body => { if (dropOnce && body?.ok && _req.method === 'POST') { dropOnce = false; res.destroy(); return res; } return json(body); }; next(); });
  app.use('/api', routes(boundary)); const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server failed'); const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, operationId = randomUUID()) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': operationId }, body: JSON.stringify(body) });
  return { ...t, boundary, base, post, stop: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); t.close(); } };
}
