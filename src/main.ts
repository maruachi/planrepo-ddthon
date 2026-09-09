import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createAppLifecycle, type AppLifecycle } from './application/app-lifecycle';
import { createHttpServer } from './application/http/server';
import { openPlanRepoDatabase } from './persistence/database';
import { createPersistence } from './persistence/transaction';
import { createMockTicketProvider } from './providers/reference/mock-ticket-provider';
import { createApplicationComposition } from './runtime/application-composition';
import { createGenerationInternalService } from './application/generation-internal';
import { ClaimContextAuthority } from './generation-runtime/claim-context';
import { ExecutionEvidenceRegistry } from './generation-runtime/execution-evidence-registry';
import { createGenerationExecutionLoop } from './generation-runtime/execution-loop';
import { CLAUDE_PROFILE_VERSION } from './providers/generation/claude-result';
import { GenerationProviderRegistry } from './providers/generation/provider-registry';
import type { RegisteredGenerationProvider } from './providers/generation/provider-registry';
import { verifyClaudeLiveCandidate } from './runtime/claude-live-candidate';
import { loadRuntimeConfig } from './runtime/config';
import { observeMacosRuntimeIdentity } from './runtime/macos-observation';
import { createMacosRecoveryObservationPort } from './runtime/macos-observation';
import { loadProjectRuleSource } from './runtime/project-rule-source';
import { createGenerationRecoveryService } from './generation-runtime/recovery';
import { createGenerationRuntimeLifecycle } from './generation-runtime/runtime-lifecycle';
import {
  evaluateClaudeEvidence,
  parseStoredClaudeVerification,
} from './runtime/claude-verification-status';

export interface RunningPlanRepo {
  readonly server: FastifyInstance;
  readonly lifecycle: AppLifecycle;
  readonly baseURL: string;
  close(): Promise<void>;
}

async function readApprovedClaudeVerification(root: string) {
  try {
    const raw: unknown = JSON.parse(
      await readFile(resolve(root, 'config/claude/verification.json'), 'utf8'),
    );
    return parseStoredClaudeVerification(raw);
  } catch {
    return undefined;
  }
}

export async function startPlanRepo(options: {
  readonly root?: string;
  readonly development?: boolean;
} = {}): Promise<RunningPlanRepo> {
  const root = options.root ?? process.cwd();
  const config = loadRuntimeConfig(root, process.env);
  await Promise.all([
    mkdir(config.paths.dataDir, { recursive: true }),
    mkdir(config.paths.runsDir, { recursive: true }),
    mkdir(config.paths.logsDir, { recursive: true }),
  ]);
  const db = openPlanRepoDatabase(join(config.paths.dataDir, 'planrepo.sqlite'));
  const runtimeId = randomUUID();
  const identity = await observeMacosRuntimeIdentity(runtimeId);
  const lifecycle = createAppLifecycle(db, {
    runtimeId,
    hostId: identity.hostId,
    bootId: identity.bootId,
    parentPid: identity.parentPid,
    parentStartedAt: identity.parentStartedAt,
    registeredAt: new Date().toISOString(),
  });
  await lifecycle.start();
  const claims = new ClaimContextAuthority(runtimeId);
  const evidence = new ExecutionEvidenceRegistry();
  const executionPolicy = {
    profileVersion: CLAUDE_PROFILE_VERSION,
    timeoutMs: 300_000 as const,
    stdoutMaxBytes: 4_194_304 as const,
    stderrMaxBytes: 262_144 as const,
    normalizedResultMaxBytes: 2_097_152 as const,
  };
  const persistence = createPersistence(db);
  const recovery = createGenerationRecoveryService({
    persistence,
    currentRuntimeId: runtimeId,
    observations: createMacosRecoveryObservationPort(identity),
  });
  const internal = createGenerationInternalService({
    persistence, claims, evidence, executionPolicy, recovery,
    draftMaxBytes: config.limits.draftBytes,
    monotonicClock: { now: () => performance.now() },
  });
  const generationRuntimeLifecycle = createGenerationRuntimeLifecycle({
    internal,
    runtime: claims.runtime,
  });
  const registeredProviders: RegisteredGenerationProvider[] = [];
  try {
    const verified = await verifyClaudeLiveCandidate({
      projectRoot: config.root,
      workRoot: config.paths.runsDir,
      sourceEnvironment: process.env,
    });
    if (verified.kind === 'Eligible') {
      const approved = await readApprovedClaudeVerification(config.root);
      if (approved !== undefined && approved.scopePolicyRef === verified.candidate.scopePolicyRef &&
        evaluateClaudeEvidence(approved).eligibleForProduct) {
        registeredProviders.push({
          providerId: config.generation.providerId,
          provider: verified.candidate.createProvider({
            observer: evidence.observer,
            evidenceSink: evidence.sink,
          }),
        });
      }
    }
  } catch {
    // Claude 지원 확인 실패는 비AI 작업 공간 기동을 막지 않습니다.
  }
  let claimingEnabled = false;
  const generationLoop = createGenerationExecutionLoop({
    internal,
    runtime: claims.runtime,
    providers: new GenerationProviderRegistry(registeredProviders),
    evidence,
    runsRoot: config.paths.runsDir,
    controlPollMs: config.generation.controlPollMs,
    canClaim: () => claimingEnabled && generationRuntimeLifecycle.canClaim(),
    recoveryBeforeClaims: generationRuntimeLifecycle.recoverBeforeClaims,
    onFailure: () => {
      claimingEnabled = false;
      generationRuntimeLifecycle.blockClaims();
      lifecycle.setGenerationReady(false);
    },
  });

  const backendOrigin = `http://${config.server.host}:${config.server.port}`;
  const developmentOrigin = `http://${config.server.host}:${config.server.devPort}`;
  const application = createApplicationComposition({
    persistence,
    mockTickets: createMockTicketProvider(),
    projectRules: loadProjectRuleSource(config.root).rules,
    documentReviewMode: true,
    generation: {
      selection: {
        providerId: config.generation.providerId,
        modelChoice: config.generation.modelChoice,
      },
      maxNonterminal: config.generation.maxNonterminal,
      providerInputBytes: config.limits.providerInputBytes,
      cancellationNotifications: generationLoop,
    },
  });
  let server: FastifyInstance | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      claimingEnabled = false;
      generationRuntimeLifecycle.blockClaims();
      lifecycle.setGenerationReady(false);
      if (server !== undefined) await server.close();
    } finally {
      try {
        await generationLoop.stop();
      } finally {
        await lifecycle.close();
      }
    }
  };

  try {
    server = createHttpServer({
      lifecycle,
      handlers: application.handlers,
      expectedHost: new URL(backendOrigin).host,
      allowedOrigin: options.development === true ? developmentOrigin : backendOrigin,
      ...(options.development === true
        ? {}
        : {
            staticRoot: resolve(config.root, 'dist/web'),
            staticBoundaryRoot: config.root,
          }),
    });
    await server.listen({ host: config.server.host, port: config.server.port });
    claimingEnabled = registeredProviders.length === 1;
    await generationLoop.start();
    lifecycle.setGenerationReady(
      claimingEnabled && generationRuntimeLifecycle.canClaim(),
    );
  } catch (error) {
    await close();
    throw error;
  }

  return { server, lifecycle, baseURL: backendOrigin, close };
}

async function runMain(): Promise<void> {
  const development = process.argv.includes('--dev');
  const app = await startPlanRepo({ development });
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    void app.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
    void signal;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  void runMain().catch(() => {
    process.stderr.write('PlanRepo 시작에 실패했습니다.\n');
    process.exitCode = 1;
  });
}
