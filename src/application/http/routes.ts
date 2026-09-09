import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  METHOD_DEFINITIONS,
  PUBLIC_METHOD_IDS,
  type PublicMethodId,
} from '@/src/contracts/methods';
import {
  ARTIFACT_MARKDOWN_MAX_BYTES,
  GENERATION_EXPLICIT_INPUT_MAX_BYTES,
  METHOD_REQUEST_SCHEMAS,
} from '@/src/contracts/schemas';
import type { CommandReceipt, CurrentBasis, DomainError } from '@/src/contracts/results';
import { WorkspaceServiceError } from '@/src/application/workspace-service';

const SINGLE_COMMAND_HEADER_MAX_BYTES = 8_192;
const EXPLICIT_RESPONSE_HEADERS_MAX_BYTES = 12 * 1_024;

export type PublicMethodHandler = (
  request: unknown,
  actorId: string | undefined,
) => Promise<unknown> | unknown;

export interface RouteDependencies {
  readonly lifecycle: {
    readiness(): {
      readonly storageReady: boolean;
      readonly generationReady: boolean;
      readonly publicCode: string;
    };
  };
  readonly handlers: Partial<Readonly<Record<PublicMethodId, PublicMethodHandler>>>;
}

function statusFor(error: DomainError): number {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'FORBIDDEN':
    case 'NOT_ASSIGNED':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'QUEUE_FULL':
      return 409;
    case 'STORE_UNAVAILABLE':
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    default:
      return 409;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  return typeof value === 'string'
    ? Buffer.byteLength(value, 'utf8')
    : Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function documentWithinLimit(methodId: PublicMethodId, body: unknown): boolean {
  if (!isObject(body) || !isObject(body.input)) return true;
  const input = body.input;
  let document: unknown;
  switch (methodId) {
    case 'M-003':
    case 'M-005':
      document = input.description;
      break;
    case 'M-006':
      if (input.kind === 'text' || input.kind === 'markdown') document = input.content;
      break;
    case 'M-015':
    case 'M-017':
      document = input.markdown;
      break;
    case 'M-018': {
      const selected = input.selectedContent;
      if (isObject(selected) && selected.kind === 'artifact' && isObject(selected.edit)) {
        document = selected.edit.markdown;
      }
      break;
    }
    case 'M-019':
      if (byteLength(input) > GENERATION_EXPLICIT_INPUT_MAX_BYTES) return false;
      if (isObject(input.body) && input.body.kind === 'artifact') {
        return (
          input.body.markdown === undefined ||
          byteLength(input.body.markdown) <= ARTIFACT_MARKDOWN_MAX_BYTES
        );
      }
      return true;
    case 'M-032':
      return byteLength(input) <= GENERATION_EXPLICIT_INPUT_MAX_BYTES;
  }
  return document === undefined || byteLength(document) <= ARTIFACT_MARKDOWN_MAX_BYTES;
}

function sendMarkdownCommand(reply: FastifyReply, output: unknown): boolean {
  if (!isObject(output) || (output.kind !== 'Committed' && output.kind !== 'Replayed')) {
    return false;
  }
  const value = output.value;
  if (!isObject(value) || !(value.bytes instanceof Uint8Array)) return false;
  if (value.contentType !== 'text/markdown; charset=utf-8') return false;
  if (value.bytes.byteLength > 8 * 1024 * 1024) {
    throw new Error('인계 문서가 허용 크기를 넘었습니다.');
  }
  if (typeof value.filename !== 'string' || /[\u0000-\u001f\u007f]/u.test(value.filename)) {
    throw new Error('안전하지 않은 다운로드 파일 이름입니다.');
  }
  const metadata: {
    kind: unknown;
    receipt: CommandReceipt | unknown;
    current?: CurrentBasis | unknown;
  } = { kind: output.kind, receipt: output.receipt };
  if (output.current !== undefined) metadata.current = output.current;
  const encoded = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url');
  if (Buffer.byteLength(encoded, 'ascii') > SINGLE_COMMAND_HEADER_MAX_BYTES) {
    throw new Error('명령 메타데이터 헤더가 너무 큽니다.');
  }
  const encodedFilename = encodeURIComponent(value.filename).replaceAll("'", '%27');
  const contentDisposition = `attachment; filename*=UTF-8''${encodedFilename}`;
  if (
    Buffer.byteLength(`content-disposition: ${contentDisposition}\r\n`, 'ascii') >
    SINGLE_COMMAND_HEADER_MAX_BYTES
  ) {
    throw new Error('다운로드 파일 이름 header가 너무 큽니다.');
  }
  const explicitHeaderBytes = Buffer.byteLength(
    `content-type: ${value.contentType}\r\n` +
      `content-disposition: ${contentDisposition}\r\n` +
      `x-planrepo-command: ${encoded}\r\n`,
    'ascii',
  );
  if (explicitHeaderBytes > EXPLICIT_RESPONSE_HEADERS_MAX_BYTES) {
    throw new Error('응답 header 합계가 너무 큽니다.');
  }
  reply
    .header('content-type', value.contentType)
    .header('content-disposition', contentDisposition)
    .header('x-planrepo-command', encoded)
    .send(Buffer.from(value.bytes));
  return true;
}

export function registerHttpRoutes(
  server: FastifyInstance,
  dependencies: RouteDependencies,
): void {
  server.get('/health/live', async (_request, reply) =>
    reply.code(200).send({ live: true }),
  );
  server.get('/health/ready', async (_request, reply) => {
    const status = dependencies.lifecycle.readiness();
    return reply.code(status.storageReady ? 200 : 503).send({
      ready: status.storageReady,
      generationReady: status.generationReady,
      code: status.publicCode,
    });
  });

  for (const methodId of PUBLIC_METHOD_IDS) {
    server.post(
      `/api/methods/${methodId}`,
      { schema: { body: METHOD_REQUEST_SCHEMAS[methodId] } },
      async (request, reply) => {
        if (!dependencies.lifecycle.readiness().storageReady) {
          return reply.code(503).send({
            code: 'STORE_UNAVAILABLE',
            message: '저장소가 준비되지 않았습니다.',
          });
        }
        if (!documentWithinLimit(methodId, request.body)) {
          return reply.code(413).send({
            code: 'VALIDATION_ERROR',
            message: '문서가 허용 크기를 넘었습니다.',
          });
        }
        const handler = dependencies.handlers[methodId];
        if (handler === undefined) {
          return reply.code(501).send({
            code: 'NOT_IMPLEMENTED',
            message: '공개 메서드가 아직 업무 서비스에 연결되지 않았습니다.',
          });
        }
        const actorHeader = request.headers['x-planrepo-actor'];
        const actorId =
          typeof actorHeader === 'string' && actorHeader.length > 0
            ? actorHeader
            : undefined;
        try {
          const output = await handler(request.body, actorId);
          if (methodId === 'M-042' && sendMarkdownCommand(reply, output)) {
            return reply;
          }
          if (isObject(output) && output.kind === 'Rejected' && isObject(output.error)) {
            return reply
              .code(statusFor(output.error as unknown as DomainError))
              .send(output);
          }
          return reply.code(200).send(output);
        } catch (error) {
          if (error instanceof WorkspaceServiceError) {
            return reply
              .code(statusFor(error.domainError))
              .send({ error: error.domainError });
          }
          return reply.code(500).send({
            code: 'INTERNAL_ERROR',
            message: '요청을 처리하지 못했습니다.',
          });
        }
      },
    );
  }

  void METHOD_DEFINITIONS;
}
