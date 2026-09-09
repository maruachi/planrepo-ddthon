import { randomUUID } from 'node:crypto';
import type { ClaimRef, EntityRef, RuntimeContext, VersionRef } from '@/src/contracts/context';
import type { DomainError } from '@/src/contracts/results';
import type {
  ClaimedRun,
  ExecutionObservation,
  ExecutionPolicy,
  ExecutionTermination,
  GenerationResult,
  ProviderCompletion,
  ProviderFailure,
  RunCompletionOutcome,
  RunControlView,
} from '@/src/contracts/views';
import type {
  InternalExecutionEvidencePort,
  MonotonicDeadlineClock,
} from '@/src/generation-runtime/execution-evidence';
import { ClaimContextAuthority } from '@/src/generation-runtime/claim-context';
import { readInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import type { DatabaseConnection } from '@/src/persistence/database';
import {
  claimNextGenerationRun,
  completeClaimedGenerationRun,
  failClaimedGenerationRun,
  insertExecutionObservation,
  readExecutionObservation,
  readGenerationRun,
  readStoredGenerationClaim,
  type StoredGenerationClaim,
} from '@/src/persistence/generation-repository';
import {
  GenerationResultInputError,
  validateGenerationResultInput,
} from '@/src/persistence/generation-run-query';
import type { Persistence } from '@/src/persistence/transaction';
import type {
  GenerationRecoveryService,
  RuntimeRecoverySummary,
} from '@/src/generation-runtime/recovery';

export type GenerationInternalErrorCode =
  | 'DEADLINE_EXCEEDED'
  | 'INVALID_EVIDENCE'
  | 'INVALID_CLAIM_STATE';

export class GenerationInternalError extends Error {
  constructor(readonly code: GenerationInternalErrorCode, message: string) {
    super(message);
  }
}

export interface ClaimedExecutionContext {
  readonly scope: import('@/src/contracts/context').SrScope;
  readonly launchIntentId: string;
}

export interface GenerationInternalDependencies {
  readonly persistence: Persistence;
  readonly claims: ClaimContextAuthority;
  readonly evidence: InternalExecutionEvidencePort;
  readonly executionPolicy: ExecutionPolicy;
  readonly draftMaxBytes: number;
  readonly monotonicClock: MonotonicDeadlineClock;
  readonly now?: () => string;
  readonly recovery?: GenerationRecoveryService;
}

export interface GenerationInternalService {
  claimRun(runtime: RuntimeContext): ClaimedRun | null;
  readClaimExecution(claimRef: ClaimRef): ClaimedExecutionContext;
  completeRun(input: ProviderCompletion): RunCompletionOutcome;
  failRun(input: ProviderFailure): RunCompletionOutcome;
  readRunControl(claimRef: ClaimRef): RunControlView;
  recordExecutionTermination(input: ExecutionTermination): ExecutionObservation;
  reconcileInterruptedRuns(runtime: RuntimeContext): Promise<RuntimeRecoverySummary>;
}

function ownershipError(message: string): DomainError {
  return {
    code: 'FORBIDDEN', message, blockers: [], assigneeIds: [], targetRefs: [],
  };
}

function claimFor(
  dependencies: GenerationInternalDependencies,
  db: DatabaseConnection,
  claimRef: ClaimRef,
): StoredGenerationClaim | undefined {
  const stored = readStoredGenerationClaim(db, claimRef);
  return stored !== undefined && dependencies.claims.verifyClaim(claimRef, stored)
    ? stored
    : undefined;
}

function isVersionRef(ref: EntityRef | VersionRef): ref is VersionRef {
  return 'version' in ref && typeof ref.version === 'number';
}

function versionRefs(result: ReturnType<typeof readInputSnapshot>): readonly VersionRef[] {
  if (result === undefined) return [];
  return result.contents.map(({ ref }) => ref).filter(isVersionRef);
}

function resultMatchesSnapshot(result: GenerationResult, snapshot: NonNullable<ReturnType<typeof readInputSnapshot>>): boolean {
  if (snapshot.taskKind === 'QUESTION_PROPOSALS') return result.kind === 'question_proposals';
  if (snapshot.taskKind === 'DECISION_PROPOSALS') return result.kind === 'decision_proposals';
  if (result.kind !== 'artifact' || snapshot.documentKind !== result.documentKind) return false;
  return snapshot.taskKind === 'ARTIFACT_DRAFT' || snapshot.taskKind === 'ARTIFACT_REVISION';
}

export function createGenerationInternalService(
  dependencies: GenerationInternalDependencies,
): GenerationInternalService {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return {
    claimRun(runtime) {
      if (!dependencies.claims.verifyRuntime(runtime)) {
        throw new GenerationInternalError('INVALID_CLAIM_STATE', 'runtime capability가 올바르지 않습니다.');
      }
      return dependencies.persistence.withinTransaction((db) => claimNextGenerationRun(db, {
        runtimeId: runtime.runtimeId,
        claimedAt: now(),
        executionPolicy: dependencies.executionPolicy,
        issue(runId, claimId) {
          return dependencies.claims.issue(runId, claimId);
        },
      }));
    },
    readClaimExecution(claimRef) {
      return dependencies.persistence.readConsistent((db) => {
        const claim = claimFor(dependencies, db, claimRef);
        if (claim === undefined) {
          throw new GenerationInternalError('INVALID_CLAIM_STATE', '생성 claim 소유권이 올바르지 않습니다.');
        }
        if (claim.executionPolicyRef !== dependencies.executionPolicy.profileVersion) {
          throw new GenerationInternalError('INVALID_CLAIM_STATE', '저장된 launch intent 정책이 현재 claim 정책과 다릅니다.');
        }
        return { scope: claim.scope, launchIntentId: claim.launchIntentId };
      });
    },
    completeRun(input) {
      return dependencies.persistence.withinTransaction((db): RunCompletionOutcome => {
        const claim = claimFor(dependencies, db, input.claimRef);
        if (claim === undefined) {
          return { kind: 'RejectedOwnership', error: ownershipError('생성 claim 소유권이 올바르지 않습니다.') };
        }
        const current = readGenerationRun(db, claim.scope, claim.runId);
        if (current === undefined) throw new GenerationInternalError('INVALID_CLAIM_STATE', 'claim Run을 찾을 수 없습니다.');
        if (current.status !== 'running') return { kind: 'IgnoredTerminal', run: current };
        const timing = dependencies.evidence.completion(input);
        if (
          timing === undefined || !Number.isFinite(timing.completedAtMono) ||
          !Number.isFinite(timing.deadlineMono) || timing.completedAtMono > timing.deadlineMono
        ) throw new GenerationInternalError('INVALID_EVIDENCE', '실제 완료 실행 증거가 올바르지 않습니다.');
        if (
          input.execution.providerId !== current.requestedSelection.providerId ||
          input.execution.profileVersion !== dependencies.executionPolicy.profileVersion ||
          input.execution.exitCode !== 0 || !input.execution.stdoutClosed || !input.execution.stderrClosed
        ) throw new GenerationInternalError('INVALID_EVIDENCE', '완료 실행 보고서가 claim 실행 정책과 다릅니다.');
        const snapshot = readInputSnapshot(db, claim.scope, current.inputSnapshotId);
        if (snapshot === undefined) throw new GenerationInternalError('INVALID_CLAIM_STATE', 'claim InputSnapshot을 찾을 수 없습니다.');
        if (!resultMatchesSnapshot(input.result, snapshot)) {
          throw new GenerationInternalError('INVALID_EVIDENCE', '생성 결과 종류가 claim InputSnapshot과 다릅니다.');
        }
        let result: GenerationResult;
        try {
          result = validateGenerationResultInput(
            input.result, claim.scope.projectId, claim.scope.srId, versionRefs(snapshot),
          );
        } catch (error) {
          if (error instanceof GenerationResultInputError) {
            throw new GenerationInternalError('INVALID_EVIDENCE', error.message);
          }
          throw error;
        }
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > dependencies.draftMaxBytes) {
          throw new GenerationInternalError('INVALID_EVIDENCE', '정제 생성 결과가 저장 한도를 넘습니다.');
        }
        if (dependencies.monotonicClock.now() > timing.deadlineMono) {
          throw new GenerationInternalError('DEADLINE_EXCEEDED', '결과 검증 뒤 저장 전에 monotonic deadline을 넘었습니다.');
        }
        const run = completeClaimedGenerationRun(db, {
          claim, result, execution: input.execution,
        });
        if (dependencies.monotonicClock.now() > timing.deadlineMono) {
          throw new GenerationInternalError('DEADLINE_EXCEEDED', '최종 저장 검증 뒤 monotonic deadline을 넘었습니다.');
        }
        return { kind: 'Recorded', run };
      });
    },
    failRun(input) {
      return dependencies.persistence.withinTransaction((db): RunCompletionOutcome => {
        const claim = claimFor(dependencies, db, input.claimRef);
        if (claim === undefined) {
          return { kind: 'RejectedOwnership', error: ownershipError('생성 claim 소유권이 올바르지 않습니다.') };
        }
        const current = readGenerationRun(db, claim.scope, claim.runId);
        if (current === undefined) throw new GenerationInternalError('INVALID_CLAIM_STATE', 'claim Run을 찾을 수 없습니다.');
        if (current.status !== 'running') return { kind: 'IgnoredTerminal', run: current };
        if (!dependencies.evidence.failure(input)) {
          throw new GenerationInternalError('INVALID_EVIDENCE', '실제 실패 실행 증거가 올바르지 않습니다.');
        }
        if (
          input.execution.providerId !== current.requestedSelection.providerId ||
          input.execution.profileVersion !== dependencies.executionPolicy.profileVersion
        ) throw new GenerationInternalError('INVALID_EVIDENCE', '실패 실행 보고서가 claim 실행 정책과 다릅니다.');
        return {
          kind: 'Recorded',
          run: failClaimedGenerationRun(db, {
            claim, failure: input.failure, execution: input.execution,
          }),
        };
      });
    },
    readRunControl(claimRef) {
      return dependencies.persistence.readConsistent((db) => {
        const claim = claimFor(dependencies, db, claimRef);
        if (claim === undefined) throw new GenerationInternalError('INVALID_CLAIM_STATE', '생성 claim 소유권이 올바르지 않습니다.');
        const run = readGenerationRun(db, claim.scope, claim.runId);
        if (run === undefined) throw new GenerationInternalError('INVALID_CLAIM_STATE', 'claim Run을 찾을 수 없습니다.');
        return {
          runId: run.runId,
          status: run.status,
          cancelRequested: run.status === 'cancelled',
          termination: run.termination,
        };
      });
    },
    recordExecutionTermination(input) {
      if (!dependencies.evidence.termination(input)) {
        throw new GenerationInternalError('INVALID_EVIDENCE', '검증된 종료 observation 증거가 없습니다.');
      }
      return dependencies.persistence.withinTransaction((db) => {
        const claim = claimFor(dependencies, db, input.claimRef);
        if (claim === undefined) throw new GenerationInternalError('INVALID_CLAIM_STATE', '생성 claim 소유권이 올바르지 않습니다.');
        const existing = readExecutionObservation(db, input.claimRef);
        if (existing !== undefined) return existing;
        return insertExecutionObservation(db, {
          claim,
          termination: input,
          observationId: `observation-${randomUUID()}`,
          observedByRuntime: dependencies.claims.runtime.runtimeId,
        });
      });
    },
    async reconcileInterruptedRuns(runtime) {
      if (!dependencies.claims.verifyRuntime(runtime)) {
        throw new GenerationInternalError('INVALID_CLAIM_STATE', 'runtime capability가 올바르지 않습니다.');
      }
      if (dependencies.recovery === undefined) {
        throw new GenerationInternalError('INVALID_CLAIM_STATE', 'generation 복구 port가 등록되지 않았습니다.');
      }
      return dependencies.recovery.reconcile();
    },
  };
}
