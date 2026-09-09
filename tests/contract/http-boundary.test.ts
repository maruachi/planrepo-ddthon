import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { maxHeaderSize, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import manifest from '@/config/demo/manifest.json';
import { createHttpServer } from '@/src/application/http/server';
import { METHOD_REQUEST_EXAMPLES } from '@/src/contracts/schemas';
import { createTestApp } from '@/tests/helpers/test-app';

const readyLifecycle = {
  async start() {},
  readiness() {
    return {
      storageReady: true,
      generationReady: false,
      publicCode: 'READY' as const,
    };
  },
  setGenerationReady() {},
  async close() {},
};

test('정상 DB는 provider가 없어도 준비되고 내부 계약은 HTTP에 없다', async () => {
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
  });
  try {
    const headers = { host: new URL(app.baseURL).host };
    const ready = await app.server.inject({
      method: 'GET',
      url: '/health/ready',
      headers,
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      ready: true,
      generationReady: false,
      code: 'READY',
    });

    const internal = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-036',
      headers: { ...headers, origin: app.baseURL },
      payload: {},
    });
    expect(internal.statusCode).toBe(404);

  } finally {
    await app.close();
  }
});

test('명시적으로 handler가 없는 공개 메서드는 501을 반환합니다', async () => {
  const server = createHttpServer({
    lifecycle: readyLifecycle,
    handlers: {},
    expectedHost: '127.0.0.1:4173',
    allowedOrigin: 'http://127.0.0.1:4173',
  });
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/methods/M-006',
      headers: {
        host: '127.0.0.1:4173',
        origin: 'http://127.0.0.1:4173',
      },
      payload: METHOD_REQUEST_EXAMPLES['M-006'],
    });
    expect(response.statusCode).toBe(501);
  } finally {
    await server.close();
  }
});

test('M-001과 M-002는 실제 empty workspace의 현재 멤버십을 읽는다', async () => {
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
  });
  try {
    const workspace = await app.invoke(
      'M-001',
      {
        actorId: manifest.defaultActorId,
        projectId: manifest.projectId,
      },
      {},
    );
    expect(workspace).toMatchObject({
      ok: true,
      disposition: 'Query',
      value: {
        project: {
          projectId: 'demo-project',
          teamId: 'demo-team',
          name: 'PlanRepo 데모 프로젝트',
        },
        connection: { kind: 'mock', available: true },
        revision: 1,
      },
    });
    if (workspace.ok) expect(workspace.value.actors).toHaveLength(5);
    expect(app.db.prepare('SELECT COUNT(*) AS count FROM srs').get()).toEqual({
      count: 0,
    });
    expect(
      app.db.prepare('SELECT COUNT(*) AS count FROM demo_seed_manifests').get(),
    ).toEqual({ count: 0 });

    const selected = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-002',
      headers: {
        host: new URL(app.baseURL).host,
        origin: app.baseURL,
      },
      payload: {
        scope: { kind: 'project', projectId: manifest.projectId },
        input: manifest.personaIds['P-03'],
      },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({
      actorId: manifest.personaIds['P-03'],
      projectId: manifest.projectId,
      roles: ['reviewer'],
      demo: true,
    });
  } finally {
    await app.close();
  }
});

test('workspace 조회의 멤버십과 존재 오류를 저장 오류로 덮지 않는다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const headers = { host: new URL(app.baseURL).host, origin: app.baseURL };
    const nonMember = await app.server.inject({
      method: 'POST', url: '/api/methods/M-001',
      headers: { ...headers, 'x-planrepo-actor': 'missing-member' },
      payload: { scope: { kind: 'project', projectId: manifest.projectId }, input: {} },
    });
    expect(nonMember.statusCode).toBe(403);
    expect(nonMember.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const missingProject = await app.server.inject({
      method: 'POST', url: '/api/methods/M-001',
      headers: { ...headers, 'x-planrepo-actor': manifest.defaultActorId },
      payload: { scope: { kind: 'project', projectId: 'missing-project' }, input: {} },
    });
    expect(missingProject.statusCode).toBe(404);
    expect(missingProject.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

    const missingActor = await app.server.inject({
      method: 'POST', url: '/api/methods/M-002', headers,
      payload: {
        scope: { kind: 'project', projectId: manifest.projectId },
        input: 'missing-member',
      },
    });
    expect(missingActor.statusCode).toBe(404);
    expect(missingActor.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

    app.db.exec('DROP TRIGGER review_policy_versions_no_update');
    app.db.prepare('UPDATE review_policy_versions SET gates_json=? WHERE project_id=?')
      .run('{}', manifest.projectId);
    const corruptPolicy = await app.server.inject({
      method: 'POST', url: '/api/methods/M-001',
      headers: { ...headers, 'x-planrepo-actor': manifest.defaultActorId },
      payload: { scope: { kind: 'project', projectId: manifest.projectId }, input: {} },
    });
    expect(corruptPolicy.statusCode).toBe(503);
    expect(corruptPolicy.json()).toMatchObject({ error: { code: 'STORE_UNAVAILABLE' } });
  } finally {
    await app.close();
  }
});

test('AJV는 지원하지 않는 필드를 삭제하지 않고 거절한다', async () => {
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
  });
  try {
    const response = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-001',
      headers: {
        host: new URL(app.baseURL).host,
        origin: app.baseURL,
        'x-planrepo-actor': manifest.defaultActorId,
      },
      payload: {
        scope: { kind: 'project', projectId: manifest.projectId },
        input: {},
        unsupported: true,
      },
    });
    expect(response.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});

test('Host와 command Origin은 잘못된 JSON parsing보다 먼저 거절된다', async () => {
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
  });
  try {
    const wrongHost = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-003',
      headers: {
        host: 'localhost:9999',
        origin: app.baseURL,
        'content-type': 'application/json',
      },
      payload: '{',
    });
    expect(wrongHost.statusCode).toBe(403);
    expect(wrongHost.json()).toEqual({
      code: 'FORBIDDEN',
      message: '허용되지 않은 Host입니다.',
    });

    const missingOrigin = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-003',
      headers: {
        host: new URL(app.baseURL).host,
        'content-type': 'application/json',
      },
      payload: '{',
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json().message).toBe('변경 요청에는 Origin이 필요합니다.');
  } finally {
    await app.close();
  }
});

test('압축 본문과 8 MiB를 넘는 실제 UTF-8 본문을 거절한다', async () => {
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
  });
  try {
    const headers = {
      host: new URL(app.baseURL).host,
      origin: app.baseURL,
      'content-type': 'application/json',
    };
    const compressed = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-003',
      headers: { ...headers, 'content-encoding': 'gzip' },
      payload: '{}',
    });
    expect(compressed.statusCode).toBe(415);

    const oversized = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-003',
      headers,
      payload: JSON.stringify({ text: '가'.repeat(2_800_000) }),
    });
    expect(Buffer.byteLength(JSON.stringify({ text: '가'.repeat(2_800_000) }))).toBeGreaterThan(
      8 * 1024 * 1024,
    );
    expect(oversized.statusCode).toBe(413);
  } finally {
    await app.close();
  }
});

test('문서 문자 수가 schema 안이어도 UTF-8 1 MiB를 넘으면 거절한다', async () => {
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
  });
  try {
    const description = '가'.repeat(400_000);
    expect(description.length).toBeLessThan(1024 * 1024);
    expect(Buffer.byteLength(description, 'utf8')).toBeGreaterThan(1024 * 1024);
    const response = await app.server.inject({
      method: 'POST',
      url: '/api/methods/M-003',
      headers: {
        host: new URL(app.baseURL).host,
        origin: app.baseURL,
      },
      payload: {
        scope: { kind: 'project', projectId: manifest.projectId },
        meta: { requestId: 'byte-limit-request', idempotencyKey: 'byte-limit-key' },
        input: {
          key: 'BYTE-1',
          title: '제목',
          purpose: '목적',
          description,
          ownerId: manifest.defaultActorId,
        },
      },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      code: 'VALIDATION_ERROR',
      message: '문서가 허용 크기를 넘었습니다.',
    });
  } finally {
    await app.close();
  }
});

test('M-019 artifact 생성 결과는 전체 입력 2 MiB 안이어도 Markdown 1 MiB를 넘으면 거절한다', async () => {
  const server = createHttpServer({
    lifecycle: readyLifecycle,
    handlers: {},
    expectedHost: '127.0.0.1:4173',
    allowedOrigin: 'http://127.0.0.1:4173',
  });
  const example = METHOD_REQUEST_EXAMPLES['M-019'];
  const input = example.input as Record<string, unknown>;
  try {
    const markdown = '한'.repeat(400_000);
    expect(Buffer.byteLength(markdown, 'utf8')).toBeGreaterThan(1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify({ ...input, body: { schemaVersion: 1, kind: 'artifact', documentKind: 'requirements', markdown, requirementRefs: [], changeSummary: '검토' } }), 'utf8')).toBeLessThan(2 * 1024 * 1024);
    const response = await server.inject({
      method: 'POST',
      url: '/api/methods/M-019',
      headers: {
        host: '127.0.0.1:4173',
        origin: 'http://127.0.0.1:4173',
      },
      payload: {
        ...example,
        input: {
          ...input,
          body: {
            schemaVersion: 1,
            kind: 'artifact',
            documentKind: 'requirements',
            markdown,
            requirementRefs: [],
            changeSummary: '검토',
          },
        },
      },
    });
    expect(response.statusCode).toBe(413);
  } finally {
    await server.close();
  }
});

test('정적 제공은 realpath root 안의 파일과 허용 화면 fallback만 연다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planrepo-static-'));
  const outside = await mkdtemp(join(tmpdir(), 'planrepo-private-'));
  await writeFile(join(root, 'index.html'), '<main>PlanRepo</main>', 'utf8');
  await writeFile(join(root, 'app.js'), 'globalThis.planrepo = true;', 'utf8');
  await writeFile(join(outside, 'secret.txt'), 'private-token', 'utf8');
  await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
  const server = createHttpServer({
    lifecycle: readyLifecycle,
    handlers: {},
    expectedHost: '127.0.0.1:4173',
    allowedOrigin: 'http://127.0.0.1:4173',
    staticRoot: root,
  });
  try {
    const headers = { host: '127.0.0.1:4173', accept: 'text/html' };
    const page = await server.inject({ method: 'GET', url: '/', headers });
    expect(page.statusCode).toBe(200);
    expect(page.body).toBe('<main>PlanRepo</main>');

    const screen = await server.inject({
      method: 'GET',
      url: '/workspace/demo',
      headers,
    });
    expect(screen.statusCode).toBe(200);
    expect(screen.body).toBe('<main>PlanRepo</main>');

    const asset = await server.inject({
      method: 'GET',
      url: '/app.js',
      headers: { host: headers.host },
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('planrepo');

    for (const url of [
      '/escape.txt',
      '/.planrepo/data/planrepo.sqlite',
      '/config/demo/manifest.json',
      '/aidlc-docs/audit.md',
      '/api/not-a-route',
      '/health/not-a-route',
    ]) {
      const response = await server.inject({ method: 'GET', url, headers });
      expect(response.statusCode, url).toBe(404);
      expect(response.body, url).not.toContain('private-token');
      expect(response.body, url).not.toContain('<main>PlanRepo</main>');
    }
  } finally {
    await server.close();
    await Promise.all([
      rm(root, { recursive: true }),
      rm(outside, { recursive: true }),
    ]);
  }
});

test('정적 root 자체나 dist 부모가 symlink면 private data를 정적 자산으로 열지 않는다', async () => {
  const boundary = await mkdtemp(join(tmpdir(), 'planrepo-static-boundary-'));
  const privateRoot = join(boundary, '.planrepo', 'data');
  const privateWeb = join(privateRoot, 'web');
  await mkdir(privateWeb, { recursive: true });
  await writeFile(join(privateRoot, 'planrepo.sqlite'), 'private-db', 'utf8');
  await writeFile(join(privateWeb, 'index.html'), '<main>private</main>', 'utf8');
  const rootLink = join(boundary, 'web-link');
  await symlink(privateRoot, rootLink);
  const distLink = join(boundary, 'dist');
  await symlink(privateRoot, distLink);
  try {
    expect(() => createHttpServer({
      lifecycle: readyLifecycle,
      handlers: {},
      expectedHost: '127.0.0.1:4173',
      allowedOrigin: 'http://127.0.0.1:4173',
      staticRoot: rootLink,
      staticBoundaryRoot: boundary,
    })).toThrow();
    expect(() => createHttpServer({
      lifecycle: readyLifecycle,
      handlers: {},
      expectedHost: '127.0.0.1:4173',
      allowedOrigin: 'http://127.0.0.1:4173',
      staticRoot: join(distLink, 'web'),
      staticBoundaryRoot: boundary,
    })).toThrow();
  } finally {
    await rm(boundary, { recursive: true });
  }
});

test('M-042는 Markdown bytes와 base64url command metadata를 분리한다', async () => {
  const receipt = {
    scope: { kind: 'sr' as const, projectId: 'demo-project', srId: 'sr-1' },
    receiptId: 'receipt-1',
    actorRef: { actorId: 'actor-1', projectId: 'demo-project' },
    commandKind: 'exportCurrentHandoff',
    requestId: 'request-1',
    idempotencyKey: 'key-1',
    inputFingerprint: 'sha256:input',
    committedRevision: 7,
    resultRefs: [],
    committedAt: '2026-09-09T00:00:00.000Z',
  };
  const server = createHttpServer({
    lifecycle: readyLifecycle,
    handlers: {
      'M-042': () => ({
        kind: 'Committed',
        value: {
          handoffId: 'handoff-1',
          filename: '인계 문서.md',
          contentType: 'text/markdown; charset=utf-8',
          bytes: new TextEncoder().encode('# 인계\n'),
        },
        receipt,
      }),
    },
    expectedHost: '127.0.0.1:4173',
    allowedOrigin: 'http://127.0.0.1:4173',
  });
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/methods/M-042',
      headers: {
        host: '127.0.0.1:4173',
        origin: 'http://127.0.0.1:4173',
      },
      payload: {
        scope: { kind: 'sr', projectId: 'demo-project', srId: 'sr-1' },
        input: 'handoff-1',
        meta: {
          requestId: 'request-1',
          idempotencyKey: 'key-1',
          guard: {
            expectedBundleRef: {
              projectId: 'demo-project',
              srId: 'sr-1',
              gate: 'G2',
              bundleId: 'bundle-1',
              version: 1,
            },
            expectedReviewEpoch: 1,
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(response.body).toBe('# 인계\n');
    const metadata = JSON.parse(
      Buffer.from(String(response.headers['x-planrepo-command'] ?? ''), 'base64url').toString('utf8'),
    );
    expect(metadata).toEqual({ kind: 'Committed', receipt });
  } finally {
    await server.close();
  }
});

test('M-042는 과대 bytes와 안전하지 않은 header 값을 성공으로 내보내지 않는다', async () => {
  const receipt = {
    scope: { kind: 'sr' as const, projectId: 'demo-project', srId: 'sr-1' },
    receiptId: 'receipt-1',
    actorRef: { actorId: 'actor-1', projectId: 'demo-project' },
    commandKind: 'exportCurrentHandoff',
    requestId: 'request-1',
    idempotencyKey: 'key-1',
    inputFingerprint: 'sha256:input',
    committedRevision: 7,
    resultRefs: [],
    committedAt: '2026-09-09T00:00:00.000Z',
  };
  const request = {
    method: 'POST' as const,
    url: '/api/methods/M-042',
    headers: {
      host: '127.0.0.1:4173',
      origin: 'http://127.0.0.1:4173',
    },
    payload: {
      scope: { kind: 'sr', projectId: 'demo-project', srId: 'sr-1' },
      input: 'handoff-1',
      meta: {
        requestId: 'request-1',
        idempotencyKey: 'key-1',
        guard: {
          expectedBundleRef: {
            projectId: 'demo-project',
            srId: 'sr-1',
            gate: 'G2',
            bundleId: 'bundle-1',
            version: 1,
          },
          expectedReviewEpoch: 1,
        },
      },
    },
  };
  const cases = [
    {
      value: {
        handoffId: 'handoff-1',
        filename: `${'한'.repeat(1_000)}.md`,
        contentType: 'text/markdown; charset=utf-8',
        bytes: new TextEncoder().encode('# 인계\n'),
      },
      current: undefined,
    },
    {
      value: {
        handoffId: 'handoff-1',
        filename: 'unsafe\r\nX-Leak: raw-identity',
        contentType: 'text/markdown; charset=utf-8',
        bytes: new TextEncoder().encode('# 인계\n'),
      },
      current: undefined,
    },
    {
      value: {
        handoffId: 'handoff-1',
        filename: 'handoff.md',
        contentType: 'text/markdown; charset=utf-8',
        bytes: new Uint8Array(8 * 1024 * 1024 + 1),
      },
      current: undefined,
    },
    {
      value: {
        handoffId: 'handoff-1',
        filename: 'handoff.md',
        contentType: 'text/markdown; charset=utf-8',
        bytes: new TextEncoder().encode('# 인계\n'),
      },
      current: {
        target: {
          kind: 'handoff',
          projectId: 'demo-project',
          srId: 'sr-1',
          entityId: 'handoff-1',
        },
        allowedActions: ['x'.repeat(9_000)],
      },
    },
  ] as const;

  for (const testCase of cases) {
    const server = createHttpServer({
      lifecycle: readyLifecycle,
      handlers: {
        'M-042': () => ({
          kind: testCase.current === undefined ? 'Committed' : 'Replayed',
          value: testCase.value,
          receipt,
          ...(testCase.current === undefined ? {} : { current: testCase.current }),
        }),
      },
      expectedHost: '127.0.0.1:4173',
      allowedOrigin: 'http://127.0.0.1:4173',
    });
    try {
      const response = await server.inject(request);
      expect(response.statusCode).toBe(500);
      expect(response.headers['x-planrepo-command']).toBeUndefined();
      expect(response.body).not.toContain('raw-identity');
      expect(response.json()).toEqual({
        code: 'INTERNAL_ERROR',
        message: '요청을 처리하지 못했습니다.',
      });
    } finally {
      await server.close();
    }
  }
});

test('M-042는 개별 상한 안의 header 합계가 Node 수신 상한을 넘기 전에 JSON으로 거절한다', async () => {
  const receipt = {
    scope: { kind: 'sr' as const, projectId: 'demo-project', srId: 'sr-1' },
    receiptId: 'receipt-combined-header',
    actorRef: { actorId: 'actor-1', projectId: 'demo-project' },
    commandKind: 'exportCurrentHandoff',
    requestId: 'request-combined-header',
    idempotencyKey: 'key-combined-header',
    inputFingerprint: 'sha256:combined-header',
    committedRevision: 7,
    resultRefs: [],
    committedAt: '2026-09-09T00:00:00.000Z',
  };
  const filename = `${'한'.repeat(904)}.md`;
  let padding = '';
  let encodedMetadataBytes = 0;
  for (let length = 5_000; length <= 7_000; length += 1) {
    const current = {
      target: {
        kind: 'handoff',
        projectId: 'demo-project',
        srId: 'sr-1',
        entityId: 'handoff-1',
      },
      allowedActions: ['x'.repeat(length)],
    };
    encodedMetadataBytes = Buffer.byteLength(
      Buffer.from(JSON.stringify({ kind: 'Replayed', receipt, current }), 'utf8')
        .toString('base64url'),
      'ascii',
    );
    if (encodedMetadataBytes >= 8_160 && encodedMetadataBytes <= 8_192) {
      padding = current.allowedActions[0] ?? '';
      break;
    }
  }
  expect(padding.length).toBeGreaterThan(0);
  expect(encodedMetadataBytes).toBeLessThanOrEqual(8_192);
  const contentDisposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  expect(Buffer.byteLength(`content-disposition: ${contentDisposition}\r\n`, 'ascii'))
    .toBeLessThanOrEqual(8_192);
  expect(
    Buffer.byteLength(`content-disposition: ${contentDisposition}\r\n`, 'ascii') +
    Buffer.byteLength(`x-planrepo-command: ${'x'.repeat(encodedMetadataBytes)}\r\n`, 'ascii') +
    Buffer.byteLength('content-type: text/markdown; charset=utf-8\r\n', 'ascii'),
  ).toBeGreaterThan(maxHeaderSize);

  const server = createHttpServer({
    lifecycle: readyLifecycle,
    handlers: {
      'M-042': () => ({
        kind: 'Replayed',
        value: {
          handoffId: 'handoff-1',
          filename,
          contentType: 'text/markdown; charset=utf-8',
          bytes: new TextEncoder().encode('# 인계\n'),
        },
        receipt,
        current: {
          target: {
            kind: 'handoff',
            projectId: 'demo-project',
            srId: 'sr-1',
            entityId: 'handoff-1',
          },
          allowedActions: [padding],
        },
      }),
    },
    expectedHost: '127.0.0.1:4173',
    allowedOrigin: 'http://127.0.0.1:4173',
  });
  try {
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.addresses()[0];
    if (address === undefined) throw new Error('테스트 listener 주소가 없습니다.');
    const payload = JSON.stringify({
      scope: { kind: 'sr', projectId: 'demo-project', srId: 'sr-1' },
      input: 'handoff-1',
      meta: {
        requestId: 'request-1',
        idempotencyKey: 'key-1',
        guard: {
          expectedBundleRef: {
            projectId: 'demo-project',
            srId: 'sr-1',
            gate: 'G2',
            bundleId: 'bundle-1',
            version: 1,
          },
          expectedReviewEpoch: 1,
        },
      },
    });
    const response = await new Promise<{ readonly statusCode: number; readonly body: string }>(
      (resolveResponse, reject) => {
        const request = httpRequest({
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/methods/M-042',
          method: 'POST',
          headers: {
            host: '127.0.0.1:4173',
            origin: 'http://127.0.0.1:4173',
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
        }, (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.once('end', () => resolveResponse({
            statusCode: incoming.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }));
        });
        request.once('error', reject);
        request.end(payload);
      },
    );
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      code: 'INTERNAL_ERROR',
      message: '요청을 처리하지 못했습니다.',
    });
  } finally {
    await server.close();
  }
});

test('TestApp.invoke는 M-042의 실제 Markdown 응답과 command header를 typed 결과로 복원한다', async () => {
  const receipt = {
    scope: { kind: 'sr' as const, projectId: manifest.projectId, srId: 'sr-1' },
    receiptId: 'receipt-test-app',
    actorRef: { actorId: manifest.defaultActorId, projectId: manifest.projectId },
    commandKind: 'exportCurrentHandoff',
    requestId: 'request-test-app',
    idempotencyKey: 'key-test-app',
    inputFingerprint: 'sha256:test-app',
    committedRevision: 9,
    resultRefs: [],
    committedAt: '2026-09-09T00:00:00.000Z',
  };
  const bytes = new TextEncoder().encode('# 실제 인계\n');
  const app = await createTestApp({
    fixture: 'empty',
    testRunId: randomUUID(),
    handlers: {
      'M-042': () => ({
        kind: 'Committed',
        value: {
          handoffId: 'handoff-test-app',
          filename: '실제 인계.md',
          contentType: 'text/markdown; charset=utf-8',
          bytes,
        },
        receipt,
      }),
    },
  });
  try {
    const result = await app.invoke(
      'M-042',
      {
        actorId: manifest.defaultActorId,
        projectId: manifest.projectId,
        srId: 'sr-1',
        requestId: receipt.requestId,
        idempotencyKey: receipt.idempotencyKey,
        guard: {
          expectedBundleRef: {
            projectId: manifest.projectId,
            srId: 'sr-1',
            gate: 'G2',
            bundleId: 'bundle-1',
            version: 1,
          },
          expectedReviewEpoch: 1,
        },
      },
      'handoff-test-app',
    );
    expect(result).toEqual({
      ok: true,
      disposition: 'Committed',
      value: {
        handoffId: 'handoff-test-app',
        filename: '실제 인계.md',
        contentType: 'text/markdown; charset=utf-8',
        bytes,
      },
      receipt,
    });
  } finally {
    await app.close();
  }
});

test.each([
  ['localhost:4173', 'http://localhost:4173', 'http://127.0.0.1:4173'],
  ['127.0.0.1:4173', 'http://127.0.0.1:4173', 'http://127.0.0.1:4173'],
  ['127.0.0.1:4173', 'http://localhost:5173', 'http://127.0.0.1:5173'],
])('로컬 별칭 %s와 Origin %s에서 화면과 API를 엽니다', async (host, origin, allowedOrigin) => {
  const root = await mkdtemp(join(tmpdir(), 'planrepo-localhost-'));
  await writeFile(join(root, 'index.html'), '<main>PlanRepo</main>', 'utf8');
  const server = createHttpServer({
    lifecycle: readyLifecycle,
    handlers: {},
    expectedHost: '127.0.0.1:4173',
    allowedOrigin,
    staticRoot: root,
  });
  try {
    const page = await server.inject({ method: 'GET', url: '/', headers: { host } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const ready = await server.inject({ method: 'GET', url: '/health/ready', headers: { host } });
    expect(ready.statusCode).toBe(200);
    const command = await server.inject({
      method: 'POST', url: '/api/methods/M-006', headers: { host, origin },
      payload: METHOD_REQUEST_EXAMPLES['M-006'],
    });
    expect(command.statusCode).toBe(501);
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});
