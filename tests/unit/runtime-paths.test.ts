import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadRuntimeConfig } from '@/src/runtime/config';
import { resolveProjectPath } from '@/src/runtime/paths';
import { createRootFixture } from '@/tests/helpers/root-fixture';

const BASE_CONFIG = {
  schemaVersion: 1,
  server: { host: '127.0.0.1', port: 4173, devPort: 5173 },
  paths: {
    dataDir: '.planrepo/data',
    runsDir: '.planrepo/runs',
    logsDir: '.planrepo/logs',
  },
  generation: {
    providerId: 'claude-cli',
    modelChoice: {
      kind: 'explicit',
      modelId: 'global.anthropic.claude-opus-4-8',
    },
    concurrency: 1,
    maxNonterminal: 10,
    timeoutMs: 300000,
    controlPollMs: 250,
    terminationGraceMs: 2000,
    terminationObservationMs: 10000,
  },
  limits: {
    commandBytes: 8388608,
    artifactBytes: 1048576,
    providerInputBytes: 2097152,
    stdoutBytes: 4194304,
    stderrBytes: 262144,
    draftBytes: 2097152,
    handoffBytes: 8388608,
  },
  sqlite: {
    journalMode: 'DELETE',
    synchronous: 'FULL',
    foreignKeys: true,
    busyTimeoutMs: 100,
  },
} as const;

function writeConfig(root: string, config: unknown = BASE_CONFIG): void {
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(
    join(root, 'config/planrepo.json'),
    JSON.stringify(config),
    'utf8',
  );
}

describe('resolveProjectPath', () => {
  test('설정 경로로 프로젝트 바깥을 선택하지 못한다', () => {
    const fixture = createRootFixture();
    try {
      expect(() =>
        resolveProjectPath(fixture.root, ['..', 'outside'].join('/')),
      ).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('새 프로젝트 루트 아래의 존재하지 않는 내부 경로를 해석한다', () => {
    const fixture = createRootFixture();
    try {
      mkdirSync(join(fixture.root, 'existing'));
      expect(resolveProjectPath(fixture.root, 'existing/new/data')).toBe(
        join(fixture.root, 'existing/new/data'),
      );
    } finally {
      fixture.remove();
    }
  });

  test('절대 경로를 거절한다', () => {
    const fixture = createRootFixture();
    try {
      expect(() =>
        resolveProjectPath(fixture.root, join(dirname(fixture.root), 'outside')),
      ).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('NUL 입력을 거절한다', () => {
    const fixture = createRootFixture();
    try {
      expect(() => resolveProjectPath(fixture.root, 'data\0outside')).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('프로젝트 밖을 가리키는 symlink 아래의 새 경로를 거절한다', () => {
    const fixture = createRootFixture();
    try {
      symlinkSync(dirname(fixture.root), join(fixture.root, 'outside-link'));
      expect(() =>
        resolveProjectPath(fixture.root, 'outside-link/new-data'),
      ).toThrow();
    } finally {
      fixture.remove();
    }
  });
});

describe('loadRuntimeConfig', () => {
  test('explicit modelId 선택을 검증한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root);
      expect(loadRuntimeConfig(fixture.root, {}).generation.modelChoice).toEqual(
        BASE_CONFIG.generation.modelChoice,
      );
    } finally {
      fixture.remove();
    }
  });

  test('installed_default 선택을 검증한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root, {
        ...BASE_CONFIG,
        generation: {
          ...BASE_CONFIG.generation,
          modelChoice: { kind: 'installed_default' },
        },
      });
      expect(loadRuntimeConfig(fixture.root, {}).generation.modelChoice).toEqual({
        kind: 'installed_default',
      });
    } finally {
      fixture.remove();
    }
  });

  test('INF-03 기본값을 새 프로젝트 루트에 붙여 읽는다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root);
      const config = loadRuntimeConfig(fixture.root, {});

      expect(config.server).toEqual({
        host: '127.0.0.1',
        port: 4173,
        devPort: 5173,
      });
      expect(config.paths).toEqual({
        dataDir: join(fixture.root, '.planrepo/data'),
        runsDir: join(fixture.root, '.planrepo/runs'),
        logsDir: join(fixture.root, '.planrepo/logs'),
      });
      expect(config.generation).toEqual(BASE_CONFIG.generation);
      expect(config.limits).toEqual(BASE_CONFIG.limits);
      expect(config.sqlite).toEqual(BASE_CONFIG.sqlite);
    } finally {
      fixture.remove();
    }
  });

  test('허용한 루트·포트·dataDir 환경 override만 적용한다', () => {
    const initial = createRootFixture();
    const selected = createRootFixture();
    try {
      writeConfig(initial.root);
      writeConfig(selected.root);
      const config = loadRuntimeConfig(initial.root, {
        PLANREPO_ROOT: selected.root,
        PLANREPO_PORT: '4310',
        PLANREPO_DEV_PORT: '5310',
        PLANREPO_DATA_DIR: '.planrepo/selected-data',
      });

      expect(config.root).toBe(selected.root);
      expect(config.server.port).toBe(4310);
      expect(config.server.devPort).toBe(5310);
      expect(config.paths.dataDir).toBe(
        join(selected.root, '.planrepo/selected-data'),
      );
    } finally {
      initial.remove();
      selected.remove();
    }
  });

  test.each(['0', '65536', '4173.5', 'port'])(
    '범위를 벗어나거나 정수가 아닌 포트 %s를 거절한다',
    (port) => {
      const fixture = createRootFixture();
      try {
        writeConfig(fixture.root);
        expect(() =>
          loadRuntimeConfig(fixture.root, { PLANREPO_PORT: port }),
        ).toThrow();
      } finally {
        fixture.remove();
      }
    },
  );

  test('schema의 미지원 키를 거절한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root, { ...BASE_CONFIG, unexpected: true });
      expect(() => loadRuntimeConfig(fixture.root, {})).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('고정된 동시 생성 제한값 변경을 거절한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root, {
        ...BASE_CONFIG,
        generation: { ...BASE_CONFIG.generation, concurrency: 2 },
      });
      expect(() => loadRuntimeConfig(fixture.root, {})).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('지원하지 않는 PLANREPO 환경 override를 거절한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root);
      expect(() =>
        loadRuntimeConfig(fixture.root, { PLANREPO_TIMEOUT_MS: '10' }),
      ).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('test mode에서 testRunId 누락을 거절한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root);
      expect(() =>
        loadRuntimeConfig(fixture.root, { PLANREPO_MODE: 'test' }),
      ).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('test mode에서 DATA_DIR override를 거절한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root);
      expect(() =>
        loadRuntimeConfig(fixture.root, {
          PLANREPO_MODE: 'test',
          PLANREPO_TEST_RUN_ID: 'isolated-run',
          PLANREPO_DATA_DIR: '.planrepo/other',
        }),
      ).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test('test mode 경로를 검증한 testRunId 아래로 격리한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root);
      const config = loadRuntimeConfig(fixture.root, {
        PLANREPO_MODE: 'test',
        PLANREPO_TEST_RUN_ID: 'isolated-run_01',
      });
      const testRoot = join(
        fixture.root,
        '.planrepo/test-runs/isolated-run_01',
      );

      expect(config.testRunId).toBe('isolated-run_01');
      expect(config.paths).toEqual({
        dataDir: join(testRoot, 'data'),
        runsDir: join(testRoot, 'runs'),
        logsDir: join(testRoot, 'logs'),
      });
    } finally {
      fixture.remove();
    }
  });

  test('test 저장소와 사용자 dataDir가 같거나 중첩되면 거절한다', () => {
    const fixture = createRootFixture();
    try {
      writeConfig(fixture.root, {
        ...BASE_CONFIG,
        paths: {
          ...BASE_CONFIG.paths,
          dataDir: '.planrepo/test-runs',
        },
      });

      expect(() =>
        loadRuntimeConfig(fixture.root, {
          PLANREPO_MODE: 'test',
          PLANREPO_TEST_RUN_ID: 'nested-run',
        }),
      ).toThrow();
    } finally {
      fixture.remove();
    }
  });

  test.each(['data', 'runs', 'logs'])(
    '최종 test %s 경로가 사용자 dataDir symlink이면 거절한다',
    (pathName) => {
      const fixture = createRootFixture();
      try {
        writeConfig(fixture.root);
        mkdirSync(join(fixture.root, '.planrepo/data'), { recursive: true });
        mkdirSync(join(fixture.root, '.planrepo/test-runs/symlink-run'), {
          recursive: true,
        });
        symlinkSync(
          '../../data',
          join(fixture.root, '.planrepo/test-runs/symlink-run', pathName),
        );

        expect(() =>
          loadRuntimeConfig(fixture.root, {
            PLANREPO_MODE: 'test',
            PLANREPO_TEST_RUN_ID: 'symlink-run',
          }),
        ).toThrowError(/test and application data paths overlap/u);
      } finally {
        fixture.remove();
      }
    },
  );
});
