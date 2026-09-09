import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { resolveProjectPath } from './paths';

export interface RuntimeConfig {
  schemaVersion: 1;
  root: string;
  mode: 'app' | 'test';
  testRunId?: string;
  server: { host: '127.0.0.1'; port: number; devPort: number };
  paths: { dataDir: string; runsDir: string; logsDir: string };
  generation: {
    providerId: 'claude-cli' | 'test';
    modelChoice:
      | { kind: 'installed_default' }
      | { kind: 'explicit'; modelId: string };
    concurrency: number;
    maxNonterminal: number;
    timeoutMs: number;
    controlPollMs: number;
    terminationGraceMs: number;
    terminationObservationMs: number;
  };
  limits: {
    commandBytes: number;
    artifactBytes: number;
    providerInputBytes: number;
    stdoutBytes: number;
    stderrBytes: number;
    draftBytes: number;
    handoffBytes: number;
  };
  sqlite: {
    journalMode: 'DELETE';
    synchronous: 'FULL';
    foreignKeys: true;
    busyTimeoutMs: number;
  };
}

type JsonObject = Record<string, unknown>;
type ConfigFile = Omit<RuntimeConfig, 'root' | 'mode' | 'testRunId'>;

const ALLOWED_ENV = new Set([
  'PLANREPO_ROOT',
  'PLANREPO_PORT',
  'PLANREPO_DEV_PORT',
  'PLANREPO_DATA_DIR',
  'PLANREPO_MODE',
  'PLANREPO_TEST_RUN_ID',
]);

function fail(context: string): never {
  throw new Error(`잘못된 PlanRepo 설정입니다: ${context}`);
}

function objectAt(value: unknown, context: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(context);
  }
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  keys: readonly string[],
  context: string,
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail(context);
  }
}

function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  context: string,
): T {
  if (value !== expected) fail(context);
  return expected;
}

function port(value: unknown, context: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  ) {
    fail(context);
  }
  return value;
}

function pathValue(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(context);
  return value;
}

function parsePortOverride(value: string, context: string): number {
  if (!/^[0-9]+$/u.test(value)) fail(context);
  return port(Number(value), context);
}

function parseConfig(value: unknown, testMode: boolean): ConfigFile {
  const root = objectAt(value, 'root');
  exactKeys(
    root,
    ['schemaVersion', 'server', 'paths', 'generation', 'limits', 'sqlite'],
    'root keys',
  );

  const server = objectAt(root.server, 'server');
  exactKeys(server, ['host', 'port', 'devPort'], 'server keys');

  const paths = objectAt(root.paths, 'paths');
  exactKeys(paths, ['dataDir', 'runsDir', 'logsDir'], 'paths keys');

  const generation = objectAt(root.generation, 'generation');
  exactKeys(
    generation,
    [
      'providerId',
      'modelChoice',
      'concurrency',
      'maxNonterminal',
      'timeoutMs',
      'controlPollMs',
      'terminationGraceMs',
      'terminationObservationMs',
    ],
    'generation keys',
  );

  const modelChoice = objectAt(generation.modelChoice, 'modelChoice');
  if (modelChoice.kind === 'installed_default') {
    exactKeys(modelChoice, ['kind'], 'modelChoice keys');
  } else if (modelChoice.kind === 'explicit') {
    exactKeys(modelChoice, ['kind', 'modelId'], 'modelChoice keys');
    if (
      typeof modelChoice.modelId !== 'string' ||
      modelChoice.modelId.length === 0
    ) {
      fail('modelChoice.modelId');
    }
  } else {
    fail('modelChoice.kind');
  }

  const limits = objectAt(root.limits, 'limits');
  exactKeys(
    limits,
    [
      'commandBytes',
      'artifactBytes',
      'providerInputBytes',
      'stdoutBytes',
      'stderrBytes',
      'draftBytes',
      'handoffBytes',
    ],
    'limits keys',
  );

  const sqlite = objectAt(root.sqlite, 'sqlite');
  exactKeys(
    sqlite,
    ['journalMode', 'synchronous', 'foreignKeys', 'busyTimeoutMs'],
    'sqlite keys',
  );

  const providerId = generation.providerId;
  if (providerId !== 'claude-cli' && !(testMode && providerId === 'test')) {
    fail('generation.providerId');
  }

  return {
    schemaVersion: literal(root.schemaVersion, 1, 'schemaVersion'),
    server: {
      host: literal(server.host, '127.0.0.1', 'server.host'),
      port: port(server.port, 'server.port'),
      devPort: port(server.devPort, 'server.devPort'),
    },
    paths: {
      dataDir: pathValue(paths.dataDir, 'paths.dataDir'),
      runsDir: pathValue(paths.runsDir, 'paths.runsDir'),
      logsDir: pathValue(paths.logsDir, 'paths.logsDir'),
    },
    generation: {
      providerId,
      modelChoice:
        modelChoice as RuntimeConfig['generation']['modelChoice'],
      concurrency: literal(
        generation.concurrency,
        1,
        'generation.concurrency',
      ),
      maxNonterminal: literal(
        generation.maxNonterminal,
        10,
        'generation.maxNonterminal',
      ),
      timeoutMs: literal(
        generation.timeoutMs,
        300000,
        'generation.timeoutMs',
      ),
      controlPollMs: literal(
        generation.controlPollMs,
        250,
        'generation.controlPollMs',
      ),
      terminationGraceMs: literal(
        generation.terminationGraceMs,
        2000,
        'generation.terminationGraceMs',
      ),
      terminationObservationMs: literal(
        generation.terminationObservationMs,
        10000,
        'generation.terminationObservationMs',
      ),
    },
    limits: {
      commandBytes: literal(
        limits.commandBytes,
        8388608,
        'limits.commandBytes',
      ),
      artifactBytes: literal(
        limits.artifactBytes,
        1048576,
        'limits.artifactBytes',
      ),
      providerInputBytes: literal(
        limits.providerInputBytes,
        2097152,
        'limits.providerInputBytes',
      ),
      stdoutBytes: literal(
        limits.stdoutBytes,
        4194304,
        'limits.stdoutBytes',
      ),
      stderrBytes: literal(
        limits.stderrBytes,
        262144,
        'limits.stderrBytes',
      ),
      draftBytes: literal(
        limits.draftBytes,
        2097152,
        'limits.draftBytes',
      ),
      handoffBytes: literal(
        limits.handoffBytes,
        8388608,
        'limits.handoffBytes',
      ),
    },
    sqlite: {
      journalMode: literal(
        sqlite.journalMode,
        'DELETE',
        'sqlite.journalMode',
      ),
      synchronous: literal(
        sqlite.synchronous,
        'FULL',
        'sqlite.synchronous',
      ),
      foreignKeys: literal(sqlite.foreignKeys, true, 'sqlite.foreignKeys'),
      busyTimeoutMs: literal(
        sqlite.busyTimeoutMs,
        100,
        'sqlite.busyTimeoutMs',
      ),
    },
  };
}

function containsPath(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return (
    fromParent === '' ||
    (fromParent !== '..' &&
      !fromParent.startsWith(`..${sep}`) &&
      !isAbsolute(fromParent))
  );
}

export function loadRuntimeConfig(
  root: string,
  env: Record<string, string | undefined>,
): RuntimeConfig {
  for (const [key, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      key.startsWith('PLANREPO_') &&
      !ALLOWED_ENV.has(key)
    ) {
      fail(`unsupported environment key ${key}`);
    }
  }

  const selectedRoot = realpathSync(env.PLANREPO_ROOT ?? root);
  const modeValue = env.PLANREPO_MODE;
  if (modeValue !== undefined && modeValue !== 'test') {
    fail('PLANREPO_MODE');
  }
  const mode = modeValue === 'test' ? 'test' : 'app';

  let raw: unknown;
  try {
    raw = JSON.parse(
      readFileSync(
        resolveProjectPath(selectedRoot, 'config/planrepo.json'),
        'utf8',
      ),
    );
  } catch (error) {
    if (error instanceof SyntaxError) fail('config/planrepo.json JSON');
    throw error;
  }

  const parsed = parseConfig(raw, mode === 'test');
  const server = {
    ...parsed.server,
    port:
      env.PLANREPO_PORT === undefined
        ? parsed.server.port
        : parsePortOverride(env.PLANREPO_PORT, 'PLANREPO_PORT'),
    devPort:
      env.PLANREPO_DEV_PORT === undefined
        ? parsed.server.devPort
        : parsePortOverride(env.PLANREPO_DEV_PORT, 'PLANREPO_DEV_PORT'),
  };

  const appDataDir = resolveProjectPath(
    selectedRoot,
    env.PLANREPO_DATA_DIR ?? parsed.paths.dataDir,
  );

  if (mode === 'app') {
    if (env.PLANREPO_TEST_RUN_ID !== undefined) {
      fail('PLANREPO_TEST_RUN_ID requires test mode');
    }
    return {
      ...parsed,
      root: selectedRoot,
      mode,
      server,
      paths: {
        dataDir: appDataDir,
        runsDir: resolveProjectPath(selectedRoot, parsed.paths.runsDir),
        logsDir: resolveProjectPath(selectedRoot, parsed.paths.logsDir),
      },
    };
  }

  if (env.PLANREPO_DATA_DIR !== undefined) {
    fail('PLANREPO_DATA_DIR is unavailable in test mode');
  }

  const testRunId = env.PLANREPO_TEST_RUN_ID;
  if (
    testRunId === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(testRunId)
  ) {
    fail('PLANREPO_TEST_RUN_ID');
  }

  const testRoot = resolveProjectPath(
    selectedRoot,
    `.planrepo/test-runs/${testRunId}`,
  );
  if (containsPath(appDataDir, testRoot) || containsPath(testRoot, appDataDir)) {
    fail('test and application data paths overlap');
  }

  const testPath = `.planrepo/test-runs/${testRunId}`;
  const testPaths = {
    dataDir: resolveProjectPath(selectedRoot, `${testPath}/data`),
    runsDir: resolveProjectPath(selectedRoot, `${testPath}/runs`),
    logsDir: resolveProjectPath(selectedRoot, `${testPath}/logs`),
  };
  if (
    Object.values(testPaths).some(
      (path) => containsPath(appDataDir, path) || containsPath(path, appDataDir),
    )
  ) {
    fail('test and application data paths overlap');
  }

  return {
    ...parsed,
    root: selectedRoot,
    mode,
    testRunId,
    server,
    paths: testPaths,
  };
}
