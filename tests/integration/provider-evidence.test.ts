import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProviderFailure } from '@/src/contracts/views';
import { ExecutionEvidenceRegistry } from '@/src/generation-runtime/execution-evidence-registry';
import { createClaudeCliProvider } from '@/src/providers/generation/claude-cli';
import { providerFixture } from '@/tests/helpers/provider-fixture';

const approvedPolicy = {
  profileVersion: 'claude-cli-2.1.265-planrepo-v2',
  timeoutMs: 300_000 as const,
  stdoutMaxBytes: 4_194_304 as const,
  stderrMaxBytes: 262_144 as const,
  normalizedResultMaxBytes: 2_097_152 as const,
};

describe('Claude provider private execution evidence', () => {
  it('정책 거절은 start 미호출을 Confirmed로 남기고 failure identity를 등록한다', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'planrepo-provider-policy-'));
    await mkdir(resolve(projectRoot, 'config/claude'), { recursive: true });
    await writeFile(resolve(projectRoot, 'config/claude/mcp-empty.json'), '{"mcpServers":{}}');
    try {
    const evidence = new ExecutionEvidenceRegistry();
    const observed: string[] = [];
    let starts = 0;
    const provider = createClaudeCliProvider({
      runner: { start() { starts += 1; throw new Error('호출되면 안 됩니다.'); } },
      projectRoot,
      mcpConfigPath: resolve(projectRoot, 'config/claude/mcp-empty.json'),
      sourceEnvironment: { HOME: '/home/test', PATH: '/bin' },
      cliVersion: '2.1.265',
      evidenceSink: evidence.sink,
      observer(state) { observed.push(`${state.kind}:${state.kind === 'Confirmed' ? state.result.kind : ''}`); },
    });
    const { request } = providerFixture();
    const outcome = await provider.generate(request, {
      signal: new AbortController().signal,
      policy: { ...approvedPolicy, profileVersion: 'unapproved-profile' },
      execution: { launchRef: 'launch-policy-reject', cwd: process.cwd() },
    });
    expect(starts).toBe(0);
    expect(observed).toEqual(['Confirmed:no_process_created']);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    const input: ProviderFailure = {
      claimRef: { runId: 'run-test', claimId: 'claim-test', ownershipToken: 'opaque-test' },
      failure: outcome.failure,
      execution: outcome.execution,
    };
    evidence.bindFailure(outcome, input);
    expect(evidence.failure(input)).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true });
    }
  });

  it('runner.start throw는 종료를 확정하지 않고 spawn_crash_gap Unknown을 남긴다', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'planrepo-provider-evidence-'));
    const cwd = resolve(projectRoot, 'run');
    await mkdir(resolve(projectRoot, 'config/claude'), { recursive: true });
    await mkdir(cwd);
    await writeFile(resolve(projectRoot, 'config/claude/mcp-empty.json'), '{"mcpServers":{}}');
    try {
      const evidence = new ExecutionEvidenceRegistry();
      const observed: string[] = [];
      const provider = createClaudeCliProvider({
        runner: { start() { throw new Error('synthetic start crash'); } },
        projectRoot,
        mcpConfigPath: resolve(projectRoot, 'config/claude/mcp-empty.json'),
        sourceEnvironment: { HOME: '/home/test', PATH: '/bin' },
        cliVersion: '2.1.265',
        evidenceSink: evidence.sink,
        observer(state) { observed.push(`${state.kind}:${state.kind === 'Unknown' ? state.reason : ''}`); },
      });
      const { request } = providerFixture();
      const outcome = await provider.generate(request, {
        signal: new AbortController().signal,
        policy: approvedPolicy,
        execution: { launchRef: 'launch-start-crash', cwd },
      });
      expect(outcome.kind).toBe('failed');
      expect(observed).toEqual(['Unknown:spawn_crash_gap']);
    } finally {
      await rm(projectRoot, { recursive: true });
    }
  });
});
