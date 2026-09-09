import {
  markGenerationRunInterrupted,
  recordHostRebootTermination,
  readPriorActiveRuntimeOwners,
  readRuntimeRecoveryCandidate,
  removeRecoveredRuntimeRegistration,
  type StoredRuntimeRecoveryCandidate,
  type StoredRuntimeRecoveryOwner,
} from '@/src/persistence/generation-repository';
import type { Persistence } from '@/src/persistence/transaction';

export type RecoveryRelation = 'same' | 'different' | 'unknown';
export type RuntimeRecoveryCandidate = StoredRuntimeRecoveryCandidate;
export type RuntimeRecoveryOwner = StoredRuntimeRecoveryOwner;

export interface RuntimeRecoveryObservation {
  readonly source: 'System' | 'Test';
  readonly hostRelation: RecoveryRelation;
  readonly bootRelation: RecoveryRelation;
  readonly hostRebootEvidence: 'confirmed' | 'unavailable';
  readonly startIdentity: 'confirmed_owner_exit' | 'unavailable';
  readonly ownerPidCheck: 'alive' | 'ESRCH' | 'unavailable';
  readonly executionTermination: 'confirmed' | 'unknown';
}

export interface RuntimeRecoveryObservationPort {
  observe(owner: RuntimeRecoveryOwner): Promise<RuntimeRecoveryObservation>;
}

export interface RuntimeRecoverySummary {
  readonly classification: 'KnownInterrupted' | 'Unknown' | 'PreservedTerminal';
  readonly goalMet: boolean;
  readonly reason: string;
  readonly inspectedCount: number;
  readonly recoveredRunIds: readonly string[];
  readonly failedRunIds: readonly string[];
  readonly unresolvedRunIds: readonly string[];
  readonly unresolvedRuntimeIds: readonly string[];
  readonly recoveryPolicyRef: 'runtime-recovery-v1';
}

export interface GenerationRecoveryService {
  reconcile(): Promise<RuntimeRecoverySummary>;
}

function sameCandidate(left: RuntimeRecoveryCandidate, right: RuntimeRecoveryCandidate): boolean {
  return left.runtimeId === right.runtimeId &&
    left.projectId === right.projectId && left.srId === right.srId &&
    left.runId === right.runId && left.claimId === right.claimId && left.status === right.status;
}

function summary(values: Omit<RuntimeRecoverySummary, 'recoveryPolicyRef'>): RuntimeRecoverySummary {
  return { ...values, recoveryPolicyRef: 'runtime-recovery-v1' };
}

function strongBasis(observation: RuntimeRecoveryObservation):
  | 'confirmed_owner_exit'
  | 'host_reboot_confirmed'
  | undefined {
  if (observation.startIdentity === 'confirmed_owner_exit') return 'confirmed_owner_exit';
  return observation.hostRelation === 'same' && observation.bootRelation === 'different' &&
    observation.hostRebootEvidence === 'confirmed'
    ? 'host_reboot_confirmed'
    : undefined;
}

export function createGenerationRecoveryService(dependencies: {
  readonly persistence: Persistence;
  readonly currentRuntimeId: string;
  readonly observations: RuntimeRecoveryObservationPort;
  readonly now?: () => string;
}): GenerationRecoveryService {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return {
    async reconcile() {
      const initial = dependencies.persistence.readConsistent((db) => {
        if (db.prepare('SELECT 1 FROM runtime_instances WHERE runtime_id=?')
          .get(dependencies.currentRuntimeId) === undefined) {
          throw new Error('등록되지 않은 runtime은 복구를 시작할 수 없습니다.');
        }
        return {
          candidate: readRuntimeRecoveryCandidate(db),
          owners: readPriorActiveRuntimeOwners(db, dependencies.currentRuntimeId),
        };
      });

      if (initial.candidate === undefined && initial.owners.length === 0) {
        return summary({
          classification: 'PreservedTerminal', goalMet: true,
          reason: '복구할 이전 활성 runtime이나 실행 slot이 없습니다.', inspectedCount: 0,
          recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: [], unresolvedRuntimeIds: [],
        });
      }

      if (initial.candidate === undefined) {
        const observations = await Promise.all(initial.owners.map(async (owner) => ({
          owner,
          observation: await dependencies.observations.observe(owner),
        })));
        return dependencies.persistence.withinTransaction((db) => {
          const currentOwners = readPriorActiveRuntimeOwners(db, dependencies.currentRuntimeId);
          if (JSON.stringify(currentOwners) !== JSON.stringify(initial.owners)) {
            return summary({
              classification: 'Unknown', goalMet: false,
              reason: '관찰 중 활성 runtime 기준이 바뀌었습니다.', inspectedCount: initial.owners.length,
              recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: [],
              unresolvedRuntimeIds: initial.owners.map(({ runtimeId }) => runtimeId),
            });
          }
          const unresolvedRuntimeIds: string[] = [];
          for (const { owner, observation } of observations) {
            if (strongBasis(observation) === undefined ||
              !removeRecoveredRuntimeRegistration(db, owner.runtimeId)) {
              unresolvedRuntimeIds.push(owner.runtimeId);
            }
          }
          if (unresolvedRuntimeIds.length > 0) {
            return summary({
              classification: 'Unknown', goalMet: false,
              reason: 'slot 없는 이전 runtime의 종료를 확정할 강한 근거가 없습니다.',
              inspectedCount: initial.owners.length,
              recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: [], unresolvedRuntimeIds,
            });
          }
          return summary({
            classification: 'KnownInterrupted', goalMet: true,
            reason: '종료가 확인된 이전 runtime의 활성 등록을 해제하고 pending 작업을 보존했습니다.',
            inspectedCount: initial.owners.length,
            recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: [], unresolvedRuntimeIds: [],
          });
        });
      }

      const initialCandidate = initial.candidate;
      if (initial.owners.length !== 1 || initial.owners[0]?.runtimeId !== initialCandidate.runtimeId) {
        return summary({
          classification: 'Unknown', goalMet: false,
          reason: '복수의 이전 활성 runtime을 단일 실행 slot과 안전하게 대응할 수 없습니다.',
          inspectedCount: initial.owners.length,
          recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: [initialCandidate.runId],
          unresolvedRuntimeIds: initial.owners.map(({ runtimeId }) => runtimeId),
        });
      }

      const observation = await dependencies.observations.observe(initialCandidate);
      return dependencies.persistence.withinTransaction((db) => {
        const current = readRuntimeRecoveryCandidate(db);
        if (current === undefined || !sameCandidate(initialCandidate, current)) {
          return summary({
            classification: 'Unknown', goalMet: false,
            reason: '관찰 중 실행 slot의 현재 기준이 바뀌었습니다.', inspectedCount: 1,
            recoveredRunIds: [], failedRunIds: [], unresolvedRunIds: [initialCandidate.runId],
            unresolvedRuntimeIds: [initialCandidate.runtimeId],
          });
        }
        if (current.status !== 'running') {
          const terminated = strongBasis(observation) === 'host_reboot_confirmed' &&
            observation.executionTermination === 'confirmed' &&
            recordHostRebootTermination(db, {
              candidate: current,
              observedByRuntime: dependencies.currentRuntimeId,
              observedAt: now(),
            });
          return summary({
            classification: 'PreservedTerminal', goalMet: terminated,
            reason: terminated
              ? '이미 확정된 terminal을 보존하고 host reboot 종료 observation을 보충했습니다.'
              : '이미 확정된 terminal 상태를 보존하고 종료 미확인 slot을 유지했습니다.',
            inspectedCount: 1, recoveredRunIds: [], failedRunIds: [],
            unresolvedRunIds: terminated ? [] : [current.runId],
            unresolvedRuntimeIds: terminated ? [] : [current.runtimeId],
          });
        }
        const basis = strongBasis(observation);
        if (basis === undefined) {
          return summary({
            classification: 'Unknown', goalMet: false,
            reason: '이전 runtime 중단을 확정할 강한 시작 identity 또는 같은 host의 reboot 근거가 없습니다.',
            inspectedCount: 1, recoveredRunIds: [], failedRunIds: [],
            unresolvedRunIds: [current.runId], unresolvedRuntimeIds: [current.runtimeId],
          });
        }
        const changed = markGenerationRunInterrupted(db, {
          candidate: current, observedByRuntime: dependencies.currentRuntimeId,
          observedAt: now(), basis,
        });
        if (!changed) {
          return summary({
            classification: 'PreservedTerminal', goalMet: false,
            reason: '동시 terminal 확정을 보존하고 종료 미확인 slot을 유지했습니다.',
            inspectedCount: 1, recoveredRunIds: [], failedRunIds: [],
            unresolvedRunIds: [current.runId], unresolvedRuntimeIds: [current.runtimeId],
          });
        }
        const terminated = basis === 'host_reboot_confirmed' &&
          observation.executionTermination === 'confirmed' &&
          recordHostRebootTermination(db, {
            candidate: current,
            observedByRuntime: dependencies.currentRuntimeId,
            observedAt: now(),
          });
        return summary({
          classification: 'KnownInterrupted', goalMet: true,
          reason: basis === 'host_reboot_confirmed'
            ? '같은 host의 검증된 boot 전환으로 이전 runtime 중단을 확정했습니다.'
            : '소유한 이전 runtime process의 종료를 확정했습니다.',
          inspectedCount: 1, recoveredRunIds: [current.runId], failedRunIds: [current.runId],
          unresolvedRunIds: terminated ? [] : [current.runId],
          unresolvedRuntimeIds: terminated ? [] : [current.runtimeId],
        });
      });
    },
  };
}
