import { loadConfig } from './config.js';
import { createApp } from './create-app.js';
async function start() {
  const config = loadConfig(); const runtime = await createApp(config);
  try { await new Promise<void>((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(config.port, config.host, resolve); }); }
  catch (e) { await runtime.close(); throw e; }
  console.log(JSON.stringify({ time: new Date().toISOString(), event: 'ready', url: `http://${config.host}:${config.port}`, database: config.dbPath, mode: config.dev ? 'development' : 'build' }));
  const stop = () => { const deadline = setTimeout(() => { console.error(JSON.stringify({ time: new Date().toISOString(), code: 'SHUTDOWN_TIMEOUT' })); process.exit(1); }, 5000); deadline.unref(); void runtime.close().then(() => { clearTimeout(deadline); process.exitCode = 0; }).catch(() => { clearTimeout(deadline); process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
start().catch((e: unknown) => { console.error(JSON.stringify({ time: new Date().toISOString(), code: 'START_FAILED', category: (e as { code?: string })?.code ?? 'CONFIG_OR_DATABASE' })); process.exitCode = 1; });
