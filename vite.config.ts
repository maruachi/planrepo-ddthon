import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import manifest from './config/demo/manifest.json';
import { loadRuntimeConfig } from './src/runtime/config';

const projectRoot = resolve(import.meta.dirname);
const runtime = loadRuntimeConfig(projectRoot, process.env);
const backendOrigin = `http://${runtime.server.host}:${runtime.server.port}`;
const developmentOrigin = `http://${runtime.server.host}:${runtime.server.devPort}`;
const devRoots = [
  resolve(projectRoot, 'src/web'),
  resolve(projectRoot, 'src/contracts'),
  resolve(projectRoot, 'node_modules'),
].map((path) => realpathSync(path));

function contains(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === '' ||
    (fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function allowedRealPath(candidate: string): boolean {
  if (!existsSync(candidate)) return true;
  const actual = realpathSync(candidate);
  return devRoots.some((root) => contains(root, actual));
}

function isAllowedDevUrl(rawUrl: string | undefined): boolean {
  if (rawUrl === undefined) return false;
  try {
    const pathname = decodeURIComponent(new URL(rawUrl, developmentOrigin).pathname);
    const first = pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    if (
      first !== undefined &&
      ['.planrepo', 'config', 'aidlc-docs', 'requirements', 'tests', 'scripts'].includes(first)
    ) {
      return false;
    }
    if (pathname.startsWith('/@fs/')) {
      const vitePath = pathname.slice('/@fs/'.length);
      const candidate = vitePath.startsWith('/') ? vitePath : `/${vitePath}`;
      return isAbsolute(candidate) && allowedRealPath(candidate);
    }
    const webCandidate = resolve(projectRoot, 'src/web', `.${pathname}`);
    return allowedRealPath(webCandidate);
  } catch {
    return false;
  }
}

const boundaryPlugin = {
  name: 'planrepo-dev-boundary',
  enforce: 'pre' as const,
  configureServer(server: {
    readonly middlewares: {
      use(handler: (
        request: { readonly url?: string; readonly headers: { readonly host?: string; readonly origin?: string } },
        response: { statusCode: number; end(body: string): void },
        next: () => void,
      ) => void): void;
    };
  }) {
    server.middlewares.use((request, response, next) => {
      if (request.headers.host !== new URL(developmentOrigin).host) {
        response.statusCode = 403;
        response.end('Forbidden');
        return;
      }
      if (
        request.headers.origin !== undefined &&
        request.headers.origin !== developmentOrigin
      ) {
        response.statusCode = 403;
        response.end('Forbidden');
        return;
      }
      if (!isAllowedDevUrl(request.url)) {
        response.statusCode = 403;
        response.end('Forbidden');
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  root: resolve(projectRoot, 'src/web'),
  publicDir: false,
  envPrefix: [],
  plugins: [boundaryPlugin, react()],
  define: {
    __PLANREPO_PROJECT_ID__: JSON.stringify(manifest.projectId),
    __PLANREPO_DEFAULT_ACTOR_ID__: JSON.stringify(manifest.defaultActorId),
  },
  resolve: { alias: { '@': projectRoot } },
  build: {
    outDir: resolve(projectRoot, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    host: runtime.server.host,
    port: runtime.server.devPort,
    strictPort: true,
    allowedHosts: [runtime.server.host],
    cors: false,
    hmr: {
      protocol: 'ws',
      host: runtime.server.host,
      port: runtime.server.devPort,
    },
    fs: {
      strict: true,
      allow: [
        ...devRoots,
      ],
    },
    proxy: {
      '^/api/methods(?:/|$)': { target: backendOrigin, changeOrigin: true },
      '/health': { target: backendOrigin, changeOrigin: true },
    },
  },
});
