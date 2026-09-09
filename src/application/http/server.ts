import fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { readFile, realpath, stat } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { AppLifecycle } from '@/src/application/app-lifecycle';
import type { PublicMethodId } from '@/src/contracts/methods';
import { METHOD_DEFINITIONS } from '@/src/contracts/methods';
import {
  registerHttpRoutes,
  type PublicMethodHandler,
} from '@/src/application/http/routes';

export type { PublicMethodHandler } from '@/src/application/http/routes';

export interface ApplicationDependencies {
  readonly lifecycle: AppLifecycle;
  readonly handlers: Partial<Readonly<Record<PublicMethodId, PublicMethodHandler>>>;
  readonly expectedHost: string;
  readonly allowedOrigin: string;
  readonly staticRoot?: string;
  readonly staticBoundaryRoot?: string;
}

const RESERVED_STATIC_PREFIXES = new Set([
  '.planrepo',
  'api',
  'health',
  'config',
  'aidlc-docs',
  'requirements',
  'src',
  'tests',
  'scripts',
]);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === '' ||
    (fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function staticPath(url: string): string | undefined {
  try {
    const pathname = decodeURIComponent(new URL(url, 'http://planrepo.invalid').pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) return undefined;
    const segments = pathname.split('/').filter((segment) => segment.length > 0);
    if (
      segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.')) ||
      (segments[0] !== undefined && RESERVED_STATIC_PREFIXES.has(segments[0].toLowerCase()))
    ) {
      return undefined;
    }
    return segments.join('/');
  } catch {
    return undefined;
  }
}

async function readStaticFile(
  root: string,
  relativePath: string,
): Promise<{ readonly bytes: Buffer; readonly path: string } | undefined> {
  const candidate = resolve(root, relativePath);
  if (!isInside(root, candidate)) return undefined;
  try {
    const resolved = await realpath(candidate);
    if (!isInside(root, resolved) || !(await stat(resolved)).isFile()) return undefined;
    return { bytes: await readFile(resolved), path: resolved };
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP')
    ) {
      return undefined;
    }
    throw error;
  }
}

function resolveStaticRoot(configuredRoot: string, configuredBoundary?: string): string {
  const lexicalRoot = resolve(configuredRoot);
  if (configuredBoundary === undefined) {
    if (lstatSync(lexicalRoot).isSymbolicLink()) {
      throw new Error('정적 root는 symbolic link일 수 없습니다.');
    }
    return realpathSync(lexicalRoot);
  }

  const lexicalBoundary = resolve(configuredBoundary);
  if (!isInside(lexicalBoundary, lexicalRoot)) {
    throw new Error('정적 root가 허용된 parent 경계 밖에 있습니다.');
  }
  let cursor = lexicalBoundary;
  const pathFromBoundary = relative(lexicalBoundary, lexicalRoot);
  for (const segment of pathFromBoundary.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error('정적 root 경로에는 symbolic link를 사용할 수 없습니다.');
    }
  }
  const actualBoundary = realpathSync(lexicalBoundary);
  const actualRoot = realpathSync(lexicalRoot);
  if (!isInside(actualBoundary, actualRoot)) {
    throw new Error('정적 root의 realpath가 허용된 parent 경계 밖에 있습니다.');
  }
  return actualRoot;
}

function registerStaticRoutes(
  server: FastifyInstance,
  configuredRoot: string,
  configuredBoundary?: string,
): void {
  const root = resolveStaticRoot(configuredRoot, configuredBoundary);
  const serve = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const requested = staticPath(request.url);
    if (requested === undefined) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: '경로를 찾을 수 없습니다.' });
    }
    const directPath = requested.length === 0 ? 'index.html' : requested;
    let selected = await readStaticFile(root, directPath);
    if (
      selected === undefined &&
      !directPath.includes('.') &&
      request.headers.accept?.includes('text/html') === true
    ) {
      selected = await readStaticFile(root, 'index.html');
    }
    if (selected === undefined) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: '경로를 찾을 수 없습니다.' });
    }
    return reply
      .header('content-type', CONTENT_TYPES[extname(selected.path).toLowerCase()] ?? 'application/octet-stream')
      .send(selected.bytes);
  };
  server.get('/', serve);
  server.get('/*', serve);
}

export function createHttpServer(
  dependencies: ApplicationDependencies,
): FastifyInstance {
  const server = fastify({
    bodyLimit: 8 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });

  const allowedHosts = new Set([
    dependencies.expectedHost,
    dependencies.expectedHost.replace(/^127\.0\.0\.1:/u, 'localhost:'),
  ]);
  const allowedOrigins = new Set([
    dependencies.allowedOrigin,
    dependencies.allowedOrigin.replace(/^http:\/\/127\.0\.0\.1:/u, 'http://localhost:'),
  ]);

  server.addHook('onRequest', async (request, reply) => {
    if (!allowedHosts.has(request.headers.host ?? '')) {
      return reply.code(403).send({
        code: 'FORBIDDEN',
        message: '허용되지 않은 Host입니다.',
      });
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return reply.code(403).send({
        code: 'FORBIDDEN',
        message: '허용되지 않은 Origin입니다.',
      });
    }
    const match = /^\/api\/methods\/(M-[0-9]{3})(?:\?|$)/u.exec(request.url);
    if (request.method === 'POST' && match !== null) {
      const methodId = match[1] as keyof typeof METHOD_DEFINITIONS;
      const definition = METHOD_DEFINITIONS[methodId];
      if (definition?.mode === 'command' && origin === undefined) {
        return reply.code(403).send({
          code: 'FORBIDDEN',
          message: '변경 요청에는 Origin이 필요합니다.',
        });
      }
      const encoding = request.headers['content-encoding'];
      if (encoding !== undefined && encoding.toLowerCase() !== 'identity') {
        return reply.code(415).send({
          code: 'VALIDATION_ERROR',
          message: 'identity Content-Encoding만 지원합니다.',
        });
      }
      const contentType = request.headers['content-type'];
      if (
        contentType === undefined ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)
      ) {
        return reply.code(415).send({
          code: 'VALIDATION_ERROR',
          message: 'application/json 요청만 지원합니다.',
        });
      }
    }
  });

  server.setErrorHandler((unknownError, _request, reply) => {
    const error = unknownError as FastifyError;
    if (error.validation !== undefined) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '요청 형식이 올바르지 않습니다.',
      });
    }
    if (error.statusCode === 413) {
      return reply.code(413).send({
        code: 'VALIDATION_ERROR',
        message: '요청 본문이 허용 크기를 넘었습니다.',
      });
    }
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: '요청을 처리하지 못했습니다.',
    });
  });

  server.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ code: 'NOT_FOUND', message: '경로를 찾을 수 없습니다.' }),
  );
  registerHttpRoutes(server, dependencies);
  if (dependencies.staticRoot !== undefined) {
    registerStaticRoutes(
      server,
      dependencies.staticRoot,
      dependencies.staticBoundaryRoot,
    );
  }
  return server;
}
