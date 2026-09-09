import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import scenarios from '@/config/demo/scenarios.json' with { type: 'json' };
import { createAppLifecycle } from '@/src/application/app-lifecycle';
import { createHttpServer } from '@/src/application/http/server';
import type { PublicMethodHandler } from '@/src/application/http/routes';
import type {
  MethodInput,
  MethodValue,
  PublicMethodId,
} from '@/src/contracts/methods';
import { METHOD_DEFINITIONS } from '@/src/contracts/methods';
import type {
  CommandReceipt,
  CurrentBasis,
  DomainError,
  MarkdownDownload,
} from '@/src/contracts/results';
import type { WriteGuard } from '@/src/contracts/context';
import {
  openPlanRepoDatabase,
  type DatabaseConnection,
} from '@/src/persistence/database';
import { migrateDatabase, runOfflineMaintenance } from '@/src/persistence/maintenance';
import { seedDemo } from '@/src/persistence/seed-demo';
import { createPersistence } from '@/src/persistence/transaction';
import { createMockTicketProvider } from '@/src/providers/reference/mock-ticket-provider';
import { createApplicationComposition } from '@/src/runtime/application-composition';
import type { CancellationNotificationPort } from '@/src/application/generation-service';
import type { ExecutionPolicy } from '@/src/contracts/views';
import { loadRuntimeConfig } from '@/src/runtime/config';
import { loadProjectRuleSource } from '@/src/runtime/project-rule-source';
import { readDemoManifest } from '@/tests/helpers/demo-manifest';

export type InvokeScope = {
  readonly actorId: string;
  readonly projectId: string;
  readonly srId?: string;
  readonly requestId?: string;
  readonly idempotencyKey?: string;
  readonly guard?: WriteGuard;
};

export type InvokeResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly disposition: 'Query' | 'Committed' | 'Replayed';
      readonly receipt?: CommandReceipt;
      readonly current?: CurrentBasis;
    }
  | {
      readonly ok: false;
      readonly error: DomainError;
      readonly priorReceipt?: CommandReceipt;
    };

export interface TestApp {
  readonly baseURL: string;
  readonly server: FastifyInstance;
  readonly db: DatabaseConnection;
  readonly generationRuntime: {
    readonly runtimeId: string;
    readonly providerId: 'claude-cli' | 'test';
    readonly runsRoot: string;
    readonly controlPollMs: number;
    readonly draftMaxBytes: number;
    readonly executionPolicy: ExecutionPolicy;
  };
  registerGenerationController(
    stop: () => Promise<void>,
    cancellationNotifications: CancellationNotificationPort,
  ): void;
  setGenerationReadyForController(ready: boolean): void;
  invoke<M extends PublicMethodId>(
    method: M,
    scope: InvokeScope,
    input: MethodInput<M>,
  ): Promise<InvokeResult<MethodValue<M>>>;
  close(): Promise<void>;
}

async function reserveLoopbackPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (address === null || typeof address === 'string') {
    reservation.close();
    throw new Error('loopback port를 예약하지 못했습니다.');
  }
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

function insertEmptyWorkspace(db: DatabaseConnection): void {
  runOfflineMaintenance(db, `empty-fixture:${randomUUID()}`, (tx) => {
    tx.prepare(
      `INSERT INTO workspace_projects(
         project_id, team_id, name, revision, default_policy_id,
         default_policy_version, provider_config_id
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(
      manifest.projectId,
      manifest.teamId,
      scenarios.project.name,
      scenarios.project.revision,
    );
    const insertMembership = tx.prepare(
      `INSERT INTO demo_user_memberships(
         project_id, user_id, display_name, roles_json, revision, demo
       ) VALUES (?, ?, ?, ?, 1, 1)`,
    );
    for (const persona of scenarios.personas) {
      const personaKey = persona.persona as keyof typeof manifest.personaIds;
      insertMembership.run(
        manifest.projectId,
        manifest.personaIds[personaKey],
        persona.displayName,
        JSON.stringify(persona.roles),
      );
    }
  });
}

function parseJson(value: string): unknown {
  return value.length === 0 ? undefined : (JSON.parse(value) as unknown);
}

function singleHeader(
  value: string | string[] | number | undefined,
  name: string,
): string {
  if (typeof value !== 'string') throw new Error(`${name} header가 올바르지 않습니다.`);
  return value;
}

function parseMarkdownCommand(
  response: Awaited<ReturnType<FastifyInstance['inject']>>,
  handoffId: string,
): InvokeResult<MarkdownDownload> {
  const contentType = singleHeader(response.headers['content-type'], 'Content-Type');
  if (contentType !== 'text/markdown; charset=utf-8') {
    throw new Error('M-042 Content-Type이 올바르지 않습니다.');
  }
  const disposition = singleHeader(
    response.headers['content-disposition'],
    'Content-Disposition',
  );
  const match = /^attachment; filename\*=UTF-8''(.+)$/u.exec(disposition);
  const encodedFilename = match?.[1];
  if (encodedFilename === undefined) {
    throw new Error('M-042 Content-Disposition이 올바르지 않습니다.');
  }
  const filename = decodeURIComponent(encodedFilename);
  const encodedMetadata = singleHeader(
    response.headers['x-planrepo-command'],
    'X-PlanRepo-Command',
  );
  const metadata = JSON.parse(
    Buffer.from(encodedMetadata, 'base64url').toString('utf8'),
  ) as {
    readonly kind: 'Committed' | 'Replayed';
    readonly receipt: CommandReceipt;
    readonly current?: CurrentBasis;
  };
  return {
    ok: true,
    value: {
      handoffId,
      filename,
      contentType,
      bytes: new Uint8Array(response.rawPayload),
    },
    disposition: metadata.kind,
    receipt: metadata.receipt,
    ...(metadata.current === undefined ? {} : { current: metadata.current }),
  };
}

export async function createTestApp(options: {
  readonly fixture: 'empty' | 'DEMO-4';
  readonly testRunId: string;
  readonly handlers?: Partial<Readonly<Record<PublicMethodId, PublicMethodHandler>>>;
  readonly serveWeb?: boolean;
  readonly cancellationNotifications?: CancellationNotificationPort;
  readonly documentReviewMode?: boolean;
}): Promise<TestApp> {
  const port = await reserveLoopbackPort();
  const projectRoot = resolve(import.meta.dirname, '../..');
  const config = loadRuntimeConfig(projectRoot, {
    PLANREPO_MODE: 'test',
    PLANREPO_TEST_RUN_ID: options.testRunId,
    PLANREPO_PORT: String(port),
  });
  const testRoot = resolve(config.paths.dataDir, '..');
  const testRunsRoot = resolve(testRoot, '..');
  await mkdir(testRunsRoot, { recursive: true });
  let rootCreated = false;
  let db: DatabaseConnection | undefined;
  let lifecycle: ReturnType<typeof createAppLifecycle> | undefined;
  let server: FastifyInstance | undefined;
  let runtimeId: string | undefined;
  let controllerStop: (() => Promise<void>) | undefined;
  let controllerNotifications: CancellationNotificationPort | undefined;
  try {
    await mkdir(testRoot);
    rootCreated = true;
    await Promise.all([
      mkdir(config.paths.dataDir),
      mkdir(config.paths.runsDir),
      mkdir(config.paths.logsDir),
    ]);
    db = openPlanRepoDatabase(join(config.paths.dataDir, 'planrepo.sqlite'));
    migrateDatabase(db);
    if (options.fixture === 'DEMO-4') {
      seedDemo(db);
      readDemoManifest(db);
    } else {
      insertEmptyWorkspace(db);
    }
    runtimeId = randomUUID();
    lifecycle = createAppLifecycle(db, {
      runtimeId,
      hostId: `unknown:${runtimeId}:host`,
      bootId: `unknown:${runtimeId}:boot`,
      parentPid: process.pid,
      parentStartedAt: 'unavailable',
      registeredAt: new Date().toISOString(),
    });
    await lifecycle.start();
    const baseURL = `http://127.0.0.1:${port}`;
    const application = createApplicationComposition({
      persistence: createPersistence(db),
      mockTickets: createMockTicketProvider(),
      projectRules: loadProjectRuleSource(config.root).rules,
      ...(options.documentReviewMode === undefined
        ? {}
        : { documentReviewMode: options.documentReviewMode }),
      generation: {
        selection: {
          providerId: config.generation.providerId,
          modelChoice: config.generation.modelChoice,
        },
        maxNonterminal: config.generation.maxNonterminal,
        providerInputBytes: config.limits.providerInputBytes,
        cancellationNotifications: {
          async notifyCancellation(scope, runId) {
            const deliveries: Promise<unknown>[] = [];
            for (const port of [controllerNotifications, options.cancellationNotifications]) {
              if (port === undefined) continue;
              try {
                deliveries.push(Promise.resolve(port.notifyCancellation(scope, runId)));
              } catch {
                // Cancellation delivery is best effort after M-034 commits.
              }
            }
            await Promise.allSettled(deliveries);
          },
        },
      },
    });
    server = createHttpServer({
      lifecycle,
      handlers: {
        ...application.handlers,
        ...options.handlers,
      },
      expectedHost: new URL(baseURL).host,
      allowedOrigin: baseURL,
      ...(options.serveWeb === true
        ? {
            staticRoot: resolve(config.root, 'dist/web'),
            staticBoundaryRoot: config.root,
          }
        : {}),
    });
    await server.listen({ host: '127.0.0.1', port });
    const addresses = server.addresses();
    if (
      addresses.length !== 1 ||
      addresses[0]?.address !== '127.0.0.1' ||
      addresses[0].port !== port
    ) {
      throw new Error('예약한 loopback port와 실제 listener가 다릅니다.');
    }
  } catch (error) {
    if (server !== undefined) await server.close().catch(() => undefined);
    if (lifecycle !== undefined) {
      await lifecycle.close().catch(() => undefined);
    } else if (db?.open === true) {
      db.close();
    }
    if (rootCreated) await rm(testRoot, { recursive: true }).catch(() => undefined);
    throw error;
  }

  const activeDb = db;
  const activeLifecycle = lifecycle;
  const activeServer = server;
  const baseURL = `http://127.0.0.1:${port}`;
  let closePromise: Promise<void> | undefined;

  return {
    baseURL,
    server: activeServer,
    db: activeDb,
    generationRuntime: {
      runtimeId,
      providerId: config.generation.providerId,
      runsRoot: config.paths.runsDir,
      controlPollMs: config.generation.controlPollMs,
      draftMaxBytes: config.limits.draftBytes,
      executionPolicy: {
        profileVersion: 'claude-cli-2.1.265-planrepo-v2',
        timeoutMs: 300_000,
        stdoutMaxBytes: 4_194_304,
        stderrMaxBytes: 262_144,
        normalizedResultMaxBytes: 2_097_152,
      },
    },
    registerGenerationController(stop, notifications) {
      if (controllerStop !== undefined) throw new Error('TestApp generation controller가 이미 등록됐습니다.');
      controllerStop = stop;
      controllerNotifications = notifications;
    },
    setGenerationReadyForController(ready) {
      activeLifecycle.setGenerationReady(ready);
    },
    async invoke<M extends PublicMethodId>(
      method: M,
      scope: InvokeScope,
      input: MethodInput<M>,
    ): Promise<InvokeResult<MethodValue<M>>> {
      const definition = METHOD_DEFINITIONS[method];
      const requestScope = scope.srId === undefined
        ? { kind: 'project' as const, projectId: scope.projectId }
        : {
            kind: 'sr' as const,
            projectId: scope.projectId,
            srId: scope.srId,
          };
      const payload = definition.mode === 'query'
        ? { scope: requestScope, input }
        : {
            scope: requestScope,
            input,
            meta: {
              requestId: scope.requestId ?? randomUUID(),
              idempotencyKey: scope.idempotencyKey ?? randomUUID(),
              ...(scope.guard === undefined ? {} : { guard: scope.guard }),
            },
          };
      const response = await activeServer.inject({
        method: 'POST',
        url: `/api/methods/${method}`,
        headers: {
          host: new URL(baseURL).host,
          origin: baseURL,
          'x-planrepo-actor': scope.actorId,
        },
        payload,
      });
      if (response.statusCode >= 400) {
        const body = parseJson(response.body);
        const envelope = body as {
          readonly error?: DomainError;
          readonly priorReceipt?: CommandReceipt;
          readonly code?: DomainError['code'];
          readonly message?: string;
        };
        return {
          ok: false,
          error: envelope.error ?? {
            code: envelope.code ?? 'STORE_UNAVAILABLE',
            message: envelope.message ?? '요청이 거절됐습니다.',
            blockers: [],
            assigneeIds: [],
            targetRefs: [],
          },
          ...(envelope.priorReceipt === undefined
            ? {}
            : { priorReceipt: envelope.priorReceipt }),
        };
      }
      if (method === 'M-042') {
        return parseMarkdownCommand(
          response,
          input as MethodInput<'M-042'>,
        ) as InvokeResult<MethodValue<M>>;
      }
      const body = parseJson(response.body);
      if (definition.mode === 'query') {
        return {
          ok: true,
          value: body as MethodValue<M>,
          disposition: 'Query',
        };
      }
      const command = body as {
        readonly kind: 'Committed' | 'Replayed';
        readonly value: MethodValue<M>;
        readonly receipt: CommandReceipt;
        readonly current?: CurrentBasis;
      };
      return {
        ok: true,
        value: command.value,
        disposition: command.kind,
        receipt: command.receipt,
        ...(command.current === undefined ? {} : { current: command.current }),
      };
    },
    async close() {
      closePromise ??= (async () => {
        let failure: unknown;
        try {
          await activeServer.close();
        } catch (error) {
          failure = error;
        }
        try {
          await controllerStop?.();
        } catch (error) {
          failure ??= error;
        }
        try {
          await activeLifecycle.close();
        } catch (error) {
          failure ??= error;
        }
        if (activeDb.open) activeDb.close();
        if (failure !== undefined) throw failure;
        await rm(testRoot, { recursive: true });
      })();
      await closePromise;
    },
  };
}
