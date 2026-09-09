import { describe, expect, it } from 'vitest';
import {
  createMacosRecoveryObservationPort,
  observeMacosRuntimeIdentity,
  type MacosObservationCommand,
} from '@/src/runtime/macos-observation';

describe('macOS runtime identity observation', () => {
  it('uses fixed bounded commands and stores digests instead of raw UUID values', async () => {
    const calls: MacosObservationCommand[] = [];
    const observation = await observeMacosRuntimeIdentity('runtime-fixed', {
      parentPid: 4321,
      run: async (command) => {
        calls.push(command);
        return command.executable === '/usr/sbin/sysctl'
          ? { stdout: '11111111-2222-4333-8444-555555555555\n' }
          : {
              stdout:
                '    "IOPlatformUUID" = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"\n',
            };
      },
    });

    expect(calls).toEqual([
      {
        executable: '/usr/sbin/sysctl',
        args: ['-n', 'kern.bootsessionuuid'],
        shell: false,
        timeoutMs: 1_000,
        maxOutputBytes: 4_096,
      },
      {
        executable: '/usr/sbin/ioreg',
        args: ['-rd1', '-c', 'IOPlatformExpertDevice', '-k', 'IOPlatformUUID'],
        shell: false,
        timeoutMs: 1_000,
        maxOutputBytes: 4_096,
      },
    ]);
    expect(observation).toEqual({
      hostId:
        'sha256:feaccd25ce867dc960f61b94779548561495698b66009d74b0ce5893b8383858',
      bootId:
        'sha256:cf4c4732fd3b8f8a55b60871950a2f22c893ea7afd75d2146826534e3f67cc49',
      parentPid: 4321,
      parentStartedAt: 'unavailable',
      recoveryObservation: 'available',
    });
    expect(JSON.stringify(observation)).not.toContain(
      'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
    );
  });

  it('compares only available same-host identities and never probes or signals the old PID', async () => {
    const port = createMacosRecoveryObservationPort({
      hostId: `sha256:${'a'.repeat(64)}`, bootId: `sha256:${'b'.repeat(64)}`, parentPid: 10,
      parentStartedAt: 'unavailable', recoveryObservation: 'available',
    });
    const candidate = {
      runtimeId: 'runtime-old', hostId: `sha256:${'a'.repeat(64)}`, bootId: `sha256:${'c'.repeat(64)}`,
      parentPid: 999_999, parentStartedAt: 'unavailable',
      projectId: 'project', srId: 'sr', runId: 'run', claimId: 'claim', status: 'running' as const,
    };
    await expect(port.observe(candidate)).resolves.toEqual({
      source: 'System', hostRelation: 'same', bootRelation: 'different',
      hostRebootEvidence: 'unavailable', startIdentity: 'unavailable',
      ownerPidCheck: 'unavailable', executionTermination: 'unknown',
    });
    await expect(createMacosRecoveryObservationPort({
      hostId: 'unknown:host', bootId: 'unknown:boot', parentPid: 10,
      parentStartedAt: 'unavailable', recoveryObservation: 'unavailable',
    }).observe(candidate)).resolves.toMatchObject({
      hostRelation: 'unknown', bootRelation: 'unknown', startIdentity: 'unavailable',
    });
  });

  it('keeps failed observations unique per runtime and unavailable for recovery', async () => {
    const failedRun = async (): Promise<{ stdout: string }> => {
      throw new Error(
        'raw-output 11111111-2222-4333-8444-555555555555 must stay private',
      );
    };

    const first = await observeMacosRuntimeIdentity('runtime-one', {
      parentPid: 100,
      run: failedRun,
    });
    const second = await observeMacosRuntimeIdentity('runtime-two', {
      parentPid: 101,
      run: failedRun,
    });

    expect(first.recoveryObservation).toBe('unavailable');
    expect(first.parentStartedAt).toBe('unavailable');
    expect(first.hostId).not.toBe(second.hostId);
    expect(first.bootId).not.toBe(second.bootId);
    expect(JSON.stringify(first)).not.toContain('raw-output');
    expect(JSON.stringify(first)).not.toContain('11111111');
  });
});
