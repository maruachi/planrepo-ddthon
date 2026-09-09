import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  RuntimeRecoveryObservationPort,
  RuntimeRecoveryOwner,
} from '@/src/generation-runtime/recovery';

export interface MacosObservationCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface RuntimeIdentityObservation {
  readonly hostId: string;
  readonly bootId: string;
  readonly parentPid: number;
  readonly parentStartedAt: 'unavailable';
  readonly recoveryObservation: 'available' | 'unavailable';
}

export type MacosObservationRunner = (
  command: MacosObservationCommand,
) => Promise<{ readonly stdout: string }>;

const execFileAsync = promisify(execFile);
const UUID = /^[{]?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[}]?$/iu;

const BOOT_COMMAND: MacosObservationCommand = {
  executable: '/usr/sbin/sysctl',
  args: ['-n', 'kern.bootsessionuuid'],
  shell: false,
  timeoutMs: 1_000,
  maxOutputBytes: 4_096,
};

const HOST_COMMAND: MacosObservationCommand = {
  executable: '/usr/sbin/ioreg',
  args: ['-rd1', '-c', 'IOPlatformExpertDevice', '-k', 'IOPlatformUUID'],
  shell: false,
  timeoutMs: 1_000,
  maxOutputBytes: 4_096,
};

const defaultRunner: MacosObservationRunner = async (command) => {
  const result = await execFileAsync(command.executable, [...command.args], {
    encoding: 'utf8',
    shell: command.shell,
    timeout: command.timeoutMs,
    maxBuffer: command.maxOutputBytes,
    windowsHide: true,
  });
  return { stdout: result.stdout };
};

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseBootUuid(stdout: string): string | undefined {
  const match = UUID.exec(stdout.trim());
  return match?.[1]?.toLowerCase();
}

function parseHostUuid(stdout: string): string | undefined {
  const match = /"IOPlatformUUID"\s*=\s*"([0-9a-f-]+)"/iu.exec(stdout);
  if (match?.[1] === undefined) return undefined;
  return parseBootUuid(match[1]);
}

async function observe(
  command: MacosObservationCommand,
  parse: (stdout: string) => string | undefined,
  unknownBasis: string,
  run: MacosObservationRunner,
): Promise<{ readonly id: string; readonly available: boolean }> {
  try {
    const result = await run(command);
    if (Buffer.byteLength(result.stdout, 'utf8') > command.maxOutputBytes) {
      return { id: `unknown:${digest(unknownBasis)}`, available: false };
    }
    const uuid = parse(result.stdout);
    if (uuid === undefined) {
      return { id: `unknown:${digest(unknownBasis)}`, available: false };
    }
    return { id: digest(uuid), available: true };
  } catch {
    return { id: `unknown:${digest(unknownBasis)}`, available: false };
  }
}

export async function observeMacosRuntimeIdentity(
  runtimeId: string,
  options: {
    readonly parentPid?: number;
    readonly run?: MacosObservationRunner;
  } = {},
): Promise<RuntimeIdentityObservation> {
  if (runtimeId.length === 0) throw new TypeError('runtimeId가 비어 있습니다.');
  const parentPid = options.parentPid ?? process.pid;
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    throw new TypeError('parentPid가 올바르지 않습니다.');
  }
  const run = options.run ?? defaultRunner;
  const [boot, host] = await Promise.all([
    observe(BOOT_COMMAND, parseBootUuid, `${runtimeId}:boot`, run),
    observe(HOST_COMMAND, parseHostUuid, `${runtimeId}:host`, run),
  ]);
  return {
    hostId: host.id,
    bootId: boot.id,
    parentPid,
    parentStartedAt: 'unavailable',
    recoveryObservation:
      host.available && boot.available ? 'available' : 'unavailable',
  };
}

function availableIdentity(id: string): boolean {
  return /^sha256:[0-9a-f]{64}$/u.test(id);
}

export function createMacosRecoveryObservationPort(
  current: RuntimeIdentityObservation,
): RuntimeRecoveryObservationPort {
  return Object.freeze({
    async observe(candidate: RuntimeRecoveryOwner) {
      const hostComparable = current.recoveryObservation === 'available' &&
        availableIdentity(candidate.hostId);
      const hostRelation = !hostComparable
        ? 'unknown' as const
        : candidate.hostId === current.hostId ? 'same' as const : 'different' as const;
      const bootComparable = hostRelation === 'same' && availableIdentity(candidate.bootId);
      const bootRelation = !bootComparable
        ? 'unknown' as const
        : candidate.bootId === current.bootId ? 'same' as const : 'different' as const;
      return {
        source: 'System' as const,
        hostRelation,
        bootRelation,
        hostRebootEvidence: 'unavailable' as const,
        startIdentity: 'unavailable' as const,
        ownerPidCheck: 'unavailable' as const,
        executionTermination: 'unknown' as const,
      };
    },
  });
}
