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
import { WorktreeSpikeService } from '../worktree-spike/worktree-spike-service.js';
import { worktreeSpikeRoutes } from '../worktree-spike/http/worktree-spike-routes.js';
import { GitWorktreeManager } from '../worktree-spike/git/git-worktree.js';
import { LegacyAidlcStateParser } from '../worktree-spike/state/legacy-aidlc-state-parser.js';
import { ScopedManifestService } from '../worktree-spike/manifest/scoped-manifest.js';
import { WorktreeAidlcRunner } from '../worktree-spike/runner/worktree-aidlc-runner.js';
import { SQLiteWorktreeSpikePersistence } from '../worktree-spike/storage/sqlite-worktree-spike-persistence.js';
import { SQLiteWorktreeReviewPersistence } from '../worktree-spike/review/sqlite-worktree-review-persistence.js';
import { WorktreeReviewService } from '../worktree-spike/review/worktree-review-service.js';
import { worktreeReviewRoutes } from '../worktree-spike/review/worktree-review-routes.js';
import { SQLiteWorktreeDocumentHistory } from '../worktree-spike/storage/sqlite-worktree-document-history.js';
import { WorktreeDocumentWriter } from '../worktree-spike/files/worktree-document-writer.js';
import { unwrap } from '../shared/errors.js';
export async function createApp(config: AppConfig) {
  const db = openDatabase(config.dbPath); const store = new SQLiteStore(db); const worker = new DiffWorkerAdapter(config.workerPath);
  const app = express(); app.disable('x-powered-by'); const server = createServer(app); let vite: ViteDevServer | undefined;
  const docs = new DocumentService(store, worker);
  const worktreeSpike = new WorktreeSpikeService({ repositoryRoot: config.repositoryPath, workspaceRoot: config.workspaceRoot, git: new GitWorktreeManager(), state: new LegacyAidlcStateParser(), manifest: new ScopedManifestService(), runner: new WorktreeAidlcRunner({ executable: config.claudePath }), requirements: { get: srId => unwrap(store.read({ kind: 'sr', srId })) }, persistence: new SQLiteWorktreeSpikePersistence(db), history: new SQLiteWorktreeDocumentHistory(db), writer: new WorktreeDocumentWriter() });
  try {
    const srs = new SRService(store); const reviews = new WorktreeReviewService(store, worktreeSpike, new SQLiteWorktreeReviewPersistence(db));
    app.use('/api', routes(new LocalAppBoundary(srs, docs, store), undefined, worktreeReviewRoutes(reviews), worktreeSpikeRoutes(worktreeSpike)));
    if (config.dev) { const { createServer: createViteServer } = await import('vite'); vite = await createViteServer({ root: config.appRoot, configFile: join(config.appRoot, 'vite.config.ts'), server: { middlewareMode: true, hmr: { server } }, appType: 'custom' }); app.use(vite.middlewares); }
    else app.use(express.static(join(config.appRoot, 'dist/client'), { index: false }));
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' || !/^(\/|\/srs\/[0-9a-f-]+(?:\/documents\/[0-9a-f-]+\/versions\/[0-9a-f-]+)?)$/i.test(req.path)) { res.status(404).type('text').send('화면을 찾을 수 없습니다.'); return; }
      try { const html = await readFile(join(config.appRoot, config.dev ? 'index.html' : 'dist/client/index.html'), 'utf8'); res.type('html').send(vite ? await vite.transformIndexHtml(req.originalUrl, html) : html); } catch (e) { next(e); }
    });
  } catch (e) { await worktreeSpike.close(); await vite?.close(); await worker.close(); if (db.open) db.close(); throw e; }
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    const stopped = new Promise<void>(resolve => server.close(() => resolve()));
    const timeout = setTimeout(() => { console.error(JSON.stringify({ time: new Date().toISOString(), code: 'SHUTDOWN_TIMEOUT' })); server.closeAllConnections(); }, 5000); timeout.unref();
    try { await worktreeSpike.close(); await worker.close(); await vite?.close(); await stopped; } finally { clearTimeout(timeout); if (db.open) db.close(); }
  })();
  return { app, server, store, close };
}
