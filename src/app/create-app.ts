import express from 'express';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { openDatabase } from '../sr-document-foundation/storage/database.js';
import { SQLiteStore } from '../sr-document-foundation/storage/sqlite-store.js';
import { SRService } from '../sr-document-foundation/services/sr-service.js';
import { DocumentService } from '../sr-document-foundation/services/document-service.js';
import { DiffWorkerAdapter } from '../sr-document-foundation/compare/diff-worker-adapter.js';
import { LocalAppBoundary } from '../sr-document-foundation/http/boundary.js';
import { routes } from '../sr-document-foundation/http/routes.js';
import type { AppConfig } from './config.js';
import { PlanningService } from '../aidlc-planning/services/planning-service.js';
import { PlanningContextBuilder } from '../aidlc-planning/context/planning-context-builder.js';
import { ClaudePlanRunner } from '../aidlc-planning/cli/claude-plan-runner.js';
import { unwrap } from '../shared/errors.js';
import type { PlanRunnerPort } from '../shared/planning-contracts.js';
import { ReviewService } from '../review-implementation/services/review-service.js';
import { reviewRoutes } from '../review-implementation/http/review-routes.js';
export async function createApp(config: AppConfig, dependencies: { runner?: PlanRunnerPort } = {}) {
  const db = openDatabase(config.dbPath); const store = new SQLiteStore(db); const worker = new DiffWorkerAdapter(config.workerPath);
  const app = express(); app.disable('x-powered-by'); const server = createServer(app); let vite: ViteDevServer | undefined;
  const docs = new DocumentService(store, worker);
  const planning = new PlanningService(store, docs, new PlanningContextBuilder(store, config.rulesPath ?? join(config.appRoot, '.aidlc-rule-details')), dependencies.runner ?? new ClaudePlanRunner({ executable: config.claudePath }));
  try {
    unwrap(planning.recoverInterrupted());
    const srs = new SRService(store); const reviews = new ReviewService(store, docs);
    app.use('/api', routes(new LocalAppBoundary(srs, docs, store), planning, reviewRoutes(reviews, srs)));
    if (config.dev) { const { createServer: createViteServer } = await import('vite'); vite = await createViteServer({ root: config.appRoot, configFile: join(config.appRoot, 'vite.config.ts'), server: { middlewareMode: true, hmr: { server } }, appType: 'custom' }); app.use(vite.middlewares); }
    else app.use(express.static(join(config.appRoot, 'dist/client'), { index: false }));
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' || !/^(\/|\/srs\/[0-9a-f-]+(?:\/documents\/[0-9a-f-]+\/versions\/[0-9a-f-]+)?)$/i.test(req.path)) { res.status(404).type('text').send('화면을 찾을 수 없습니다.'); return; }
      try { const html = await readFile(join(config.appRoot, config.dev ? 'index.html' : 'dist/client/index.html'), 'utf8'); res.type('html').send(vite ? await vite.transformIndexHtml(req.originalUrl, html) : html); } catch (e) { next(e); }
    });
  } catch (e) { await planning.close(); await vite?.close(); await worker.close(); if (db.open) db.close(); throw e; }
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    const stopped = new Promise<void>(resolve => server.close(() => resolve()));
    const timeout = setTimeout(() => { console.error(JSON.stringify({ time: new Date().toISOString(), code: 'SHUTDOWN_TIMEOUT' })); server.closeAllConnections(); }, 5000); timeout.unref();
    try { await planning.close(); await worker.close(); await vite?.close(); await stopped; } finally { clearTimeout(timeout); if (db.open) db.close(); }
  })();
  return { app, server, store, planning, close };
}
