import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RestrictedProcessRunner,
  verifyRestrictedProcessSupport,
} from '@/src/runtime/restricted-process-runner';
import type { ProcessObservationState } from '@/src/runtime/process-evidence';
import {
  APPROVED_CLAUDE_VERSION,
  CLAUDE_PROFILE_FINGERPRINT,
} from '@/src/providers/generation/claude-profile';
import { verifyClaudeLiveCandidate } from '@/src/runtime/claude-live-candidate';

async function waitForRestrictedExit(states: readonly ProcessObservationState[]): Promise<ProcessObservationState> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = states.at(-1);
    if (state?.kind === 'Confirmed' && state.result.kind === 'restricted_scope_exited') return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('restricted scope 종료 관찰을 기다리는 시간이 초과됐습니다.');
}

describe('macOS restricted process capability', () => {
  it('binds an actual no-fork probe to the exact supported OS and Claude profile', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'planrepo-restricted-probe-'));
    try {
      const result = await verifyRestrictedProcessSupport({
        projectRoot: process.cwd(),
        workRoot,
        claudeProfileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
        cliVersion: APPROVED_CLAUDE_VERSION,
      });
      expect(result).toMatchObject({
        kind: 'Supported',
        capability: { scopePolicyRef: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) },
        platformRef: 'darwin-25.6.0-macos-26.6.2-build-25G83-arm64',
      });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  });

  it('publishes a restricted scope exit only after its direct child and both pipes close', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'planrepo-restricted-close-'));
    try {
      const verified = await verifyRestrictedProcessSupport({
        projectRoot: process.cwd(), workRoot,
        claudeProfileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
        cliVersion: APPROVED_CLAUDE_VERSION,
      });
      if (verified.kind !== 'Supported') throw new Error(verified.reason);
      const states: ProcessObservationState[] = [];
      const execution = new RestrictedProcessRunner(verified.capability).start({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("restricted-ok")'],
        cwd: workRoot,
        env: {},
        stdinBytes: Buffer.alloc(0),
        launchRef: 'restricted-close',
        limits: {
          stdinMaxBytes: 1024, stdoutMaxBytes: 1024, stderrMaxBytes: 1024,
          timeoutMs: 5_000, terminationGraceMs: 500,
        },
      }, (state) => states.push(state));
      await expect(execution.result).resolves.toMatchObject({ kind: 'Completed' });
      expect(states.at(-1)).toMatchObject({
        kind: 'Confirmed',
        launchRef: 'restricted-close',
        result: {
          kind: 'restricted_scope_exited',
          scopePolicyRef: verified.capability.scopePolicyRef,
          exitCode: 0,
        },
      });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  });

  it('issues a private live candidate only after the bounded current CLI and restriction preflight', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'planrepo-claude-preflight-'));
    try {
      const result = await verifyClaudeLiveCandidate({
        projectRoot: process.cwd(), workRoot, sourceEnvironment: process.env,
      });
      expect(result).toMatchObject({
        kind: 'Eligible',
        candidate: {
          report: {
            cliProbe: 'Passed', optionProbe: 'Passed', policyPreflight: 'Passed',
            actualGeneration: 'NotRun', actualIsolation: 'NotRun',
            sameBootRecovery: 'KnownUnsupported',
          },
          scopePolicyRef: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        },
      });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'nonzero exit', program: 'process.exit(7)', action: 'none' as const, resultCode: 'PROCESS_FAILED' },
    { name: 'cancellation', program: 'setInterval(()=>{},1000)', action: 'cancel' as const, resultCode: 'CANCELLED' },
    { name: 'timeout', program: 'setInterval(()=>{},1000)', action: 'timeout' as const, resultCode: 'TIMEOUT' },
  ])('keeps $name terminal separate and confirms only the closed restricted scope', async ({ program, action, resultCode }) => {
    const workRoot = await mkdtemp(join(tmpdir(), 'planrepo-restricted-terminal-'));
    try {
      const verified = await verifyRestrictedProcessSupport({
        projectRoot: process.cwd(), workRoot,
        claudeProfileFingerprint: CLAUDE_PROFILE_FINGERPRINT,
        cliVersion: APPROVED_CLAUDE_VERSION,
      });
      if (verified.kind !== 'Supported') throw new Error(verified.reason);
      const states: ProcessObservationState[] = [];
      const execution = new RestrictedProcessRunner(verified.capability).start({
        executable: process.execPath,
        args: ['-e', program],
        cwd: workRoot, env: {}, stdinBytes: Buffer.alloc(0),
        launchRef: `restricted-${action}`,
        limits: {
          stdinMaxBytes: 1024, stdoutMaxBytes: 1024, stderrMaxBytes: 1024,
          timeoutMs: action === 'timeout' ? 50 : 5_000, terminationGraceMs: 100,
        },
      }, (state) => states.push(state));
      if (action === 'cancel') {
        for (let attempt = 0; attempt < 100 && states.at(-1)?.kind !== 'Running'; attempt += 1) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        }
        execution.requestStop('test cancellation');
      }
      await expect(execution.result).resolves.toMatchObject({ kind: 'Failure', code: resultCode });
      const closed = await waitForRestrictedExit(states);
      expect(closed).toMatchObject({
        kind: 'Confirmed',
        result: {
          kind: 'restricted_scope_exited',
          scopePolicyRef: verified.capability.scopePolicyRef,
        },
      });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  });

  it('rejects a changed Claude profile before issuing the private capability', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'planrepo-restricted-mismatch-'));
    try {
      await expect(verifyRestrictedProcessSupport({
        projectRoot: process.cwd(), workRoot,
        claudeProfileFingerprint: `sha256:${'f'.repeat(64)}`,
        cliVersion: APPROVED_CLAUDE_VERSION,
      })).resolves.toEqual({ kind: 'Unsupported', reason: 'PROFILE_MISMATCH' });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  });
});
