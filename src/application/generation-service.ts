import { createHash, randomUUID } from 'node:crypto';
import type {
  CommandContext,
  FingerprintGuard,
  NoGuard,
  QueryContext,
  SrScope,
} from '@/src/contracts/context';
import type { CommandReceipt, CommandResult, CurrentBasis, DomainError } from '@/src/contracts/results';
import type {
  GenerationInput,
  GenerationRunId,
  GenerationRunView,
  InputFreshness,
  ProviderSelection,
} from '@/src/contracts/views';
import { canonicalJson, GenerationInputBasisError, GenerationInputTooLargeError, prepareGenerationSnapshot } from '@/src/application/generation-snapshot';
import { GenerationPreparationError, readGenerationPreparation } from '@/src/application/generation-preparation';
import { WorkspaceServiceError } from '@/src/application/workspace-service';
import { requireProjectMember, requireSrOwner } from '@/src/domain/authorization';
import { readCommandReceipt, storeCommandReceipt } from '@/src/persistence/command-receipts';
import { GenerationBasisReadError, readGenerationBasis } from '@/src/persistence/generation-input-repository';
import { InputSnapshotRepositoryError, insertInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import {
  cancelGenerationRun,
  countNonterminalGenerationRuns,
  insertGenerationActivity,
  insertPendingGenerationRun,
  readGenerationRun,
} from '@/src/persistence/generation-repository';
import { GenerationRunReadError, type CurrentInputFingerprintPort } from '@/src/persistence/generation-run-query';
import { readMembership, readSrOwner } from '@/src/persistence/sr-repository';
import type { Persistence } from '@/src/persistence/transaction';
import type { DatabaseConnection } from '@/src/persistence/database';
import type { ProviderRequest } from '@/src/providers/generation/provider-contract';
import type { ProjectRuleSnapshot } from '@/src/runtime/project-rule-source';

type GenerationCommand<G extends FingerprintGuard | NoGuard> = CommandContext<SrScope, G>;

class GenerationProviderRequestTooLargeError extends Error {}

export interface CancellationNotificationPort {
  notifyCancellation(scope: SrScope, runId: string): void | Promise<void>;
}

export interface GenerationServiceDependencies {
  readonly persistence: Persistence;
  readonly projectRules: ProjectRuleSnapshot;
  readonly selection: ProviderSelection;
  readonly maxNonterminal: number;
  readonly providerInputBytes: number;
  readonly currentInputFingerprints: CurrentInputFingerprintPort;
  readonly cancellationNotifications?: CancellationNotificationPort;
  readonly now?: () => string;
}

export interface GenerationService {
  requestGeneration(
    ctx: GenerationCommand<FingerprintGuard>,
    input: GenerationInput,
  ): CommandResult<GenerationRunView>;
  getGeneration(ctx: QueryContext<SrScope>, runId: GenerationRunId): GenerationRunView;
  cancelGeneration(
    ctx: GenerationCommand<NoGuard>,
    runId: GenerationRunId,
  ): CommandResult<GenerationRunView>;
  retryGeneration(
    ctx: GenerationCommand<FingerprintGuard>,
    runId: GenerationRunId,
  ): CommandResult<GenerationRunView>;
}

function domainError(code: DomainError['code'], message: string, current?: CurrentBasis): DomainError {
  return {
    code,
    message,
    ...(current === undefined ? {} : { current }),
    blockers: [],
    assigneeIds: [],
    targetRefs: [],
  };
}

function rejected<T>(error: DomainError, priorReceipt?: CommandReceipt): CommandResult<T> {
  return {
    kind: 'Rejected',
    error,
    ...(priorReceipt === undefined ? {} : { priorReceipt }),
  };
}

function runCurrentBasis(run: GenerationRunView, inputFingerprint?: string): CurrentBasis {
  return {
    target: {
      kind: 'generation_run',
      projectId: run.scope.projectId,
      srId: run.scope.srId,
      entityId: run.runId,
    },
    currentRevision: run.revision,
    ...(inputFingerprint === undefined ? {} : { inputFingerprint }),
    allowedActions: [],
  };
}

function inputCurrentBasis(scope: SrScope, fingerprint: string): CurrentBasis {
  return {
    target: { kind: 'sr', projectId: scope.projectId, srId: scope.srId, entityId: scope.srId },
    inputFingerprint: fingerprint,
    allowedActions: [],
  };
}

function commandFingerprint(
  commandKind: 'M-032' | 'M-034' | 'M-035',
  ctx: GenerationCommand<FingerprintGuard | NoGuard>,
  input: unknown,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson({
    schemaVersion: 1,
    commandKind,
    scope: ctx.scope,
    guard: ctx.guard,
    input,
  })).digest('hex')}`;
}

function isSqliteError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && error.code.startsWith('SQLITE_');
}

function storedReplayRun(
  value: unknown,
  scope: SrScope,
  commandKind: 'M-032' | 'M-034' | 'M-035',
): GenerationRunView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GenerationRunReadError('generation receipt replay가 객체가 아닙니다.');
  }
  const run = value as Record<string, unknown>;
  const storedScope = run.scope as Record<string, unknown> | undefined;
  const selection = run.requestedSelection as Record<string, unknown> | undefined;
  const modelChoice = selection?.modelChoice as Record<string, unknown> | undefined;
  const application = run.application as Record<string, unknown> | undefined;
  const freshness = run.freshness;
  const unknownFreshness = freshness as Record<string, unknown> | undefined;
  if (
    typeof storedScope !== 'object' || storedScope === null || Array.isArray(storedScope) ||
    storedScope.kind !== 'sr' || storedScope.projectId !== scope.projectId || storedScope.srId !== scope.srId ||
    typeof run.runId !== 'string' || run.runId.length === 0 ||
    typeof run.inputSnapshotId !== 'string' || run.inputSnapshotId.length === 0 ||
    typeof run.requestedBy !== 'string' || typeof run.requestedAt !== 'string' ||
    !Number.isInteger(run.revision) || Number(run.revision) < 1 ||
    (run.taskKind !== 'QUESTION_PROPOSALS' && run.taskKind !== 'DECISION_PROPOSALS' &&
      run.taskKind !== 'ARTIFACT_DRAFT' && run.taskKind !== 'ARTIFACT_REVISION') ||
    typeof selection !== 'object' || selection === null || Array.isArray(selection) ||
    typeof selection.providerId !== 'string' || selection.providerId.length === 0 ||
    typeof modelChoice !== 'object' || modelChoice === null || Array.isArray(modelChoice) ||
    (modelChoice.kind !== 'installed_default' &&
      (modelChoice.kind !== 'explicit' || typeof modelChoice.modelId !== 'string' || modelChoice.modelId.length === 0)) ||
    (run.actualModelId !== undefined &&
      (typeof run.actualModelId !== 'string' || run.actualModelId.length === 0)) ||
    (run.cliVersion !== undefined &&
      (typeof run.cliVersion !== 'string' || run.cliVersion.length === 0)) ||
    (commandKind === 'M-034'
      ? run.termination !== 'unobserved' && run.termination !== 'confirmed'
      : run.termination !== 'unobserved') ||
    application?.kind !== 'not_applied' ||
    (freshness !== 'current' && freshness !== 'stale' &&
      (typeof unknownFreshness !== 'object' || unknownFreshness === null || Array.isArray(unknownFreshness) ||
        unknownFreshness.kind !== 'unknown' || typeof unknownFreshness.reason !== 'string' || unknownFreshness.reason.length === 0)) ||
    (commandKind === 'M-034' ? run.status !== 'cancelled' : run.status !== 'pending')
  ) {
    throw new GenerationRunReadError('generation receipt replay 계약이 올바르지 않습니다.');
  }
  if (
    commandKind === 'M-034' &&
    (typeof run.cancelledBy !== 'string' || typeof run.cancelledAt !== 'string')
  ) throw new GenerationRunReadError('generation 취소 receipt 근거가 올바르지 않습니다.');
  const requestedSelection: ProviderSelection = modelChoice.kind === 'installed_default'
    ? { providerId: selection.providerId as string, modelChoice: { kind: 'installed_default' } }
    : {
        providerId: selection.providerId as string,
        modelChoice: { kind: 'explicit', modelId: modelChoice.modelId as string },
      };
  const decodedFreshness: InputFreshness = freshness === 'current' || freshness === 'stale'
    ? freshness
    : { kind: 'unknown' as const, reason: unknownFreshness?.reason as string };
  const base = {
    scope: { kind: 'sr' as const, projectId: scope.projectId, srId: scope.srId },
    runId: run.runId as string,
    taskKind: run.taskKind as GenerationRunView['taskKind'],
    inputSnapshotId: run.inputSnapshotId as string,
    revision: Number(run.revision),
    requestedBy: run.requestedBy as string,
    requestedAt: run.requestedAt as string,
    requestedSelection,
    ...(run.actualModelId === undefined ? {} : { actualModelId: run.actualModelId as string }),
    ...(run.cliVersion === undefined ? {} : { cliVersion: run.cliVersion as string }),
    freshness: decodedFreshness,
    termination: run.termination as 'unobserved' | 'confirmed',
    application: { kind: 'not_applied' as const },
  };
  return commandKind === 'M-034'
    ? {
        ...base,
        status: 'cancelled',
        cancelledBy: run.cancelledBy as string,
        cancelledAt: run.cancelledAt as string,
      }
    : { ...base, status: 'pending' };
}

function authorizeOwner(
  db: DatabaseConnection,
  ctx: QueryContext<SrScope>,
): DomainError | undefined {
  const membership = requireProjectMember(
    ctx.actor.actorId,
    readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
  );
  if (membership !== undefined) return membership;
  const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
  if (ownerId === undefined) return domainError('NOT_FOUND', '생성 대상 SR을 찾을 수 없습니다.');
  return requireSrOwner(ctx.actor.actorId, ownerId);
}

function authorizeMemberScope(db: DatabaseConnection, ctx: QueryContext<SrScope>): DomainError | undefined {
  const membership = requireProjectMember(
    ctx.actor.actorId,
    readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
  );
  if (membership !== undefined) return membership;
  return readSrOwner(db, ctx.scope.projectId, ctx.scope.srId) === undefined
    ? domainError('NOT_FOUND', '생성 대상 SR을 찾을 수 없습니다.')
    : undefined;
}

function receiptFor(
  ctx: GenerationCommand<FingerprintGuard | NoGuard>,
  commandKind: 'M-032' | 'M-034' | 'M-035',
  inputFingerprint: string,
  run: GenerationRunView,
  committedAt: string,
): CommandReceipt {
  return {
    scope: ctx.scope,
    receiptId: `receipt-${randomUUID()}`,
    actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
    commandKind,
    requestId: ctx.requestId,
    idempotencyKey: ctx.idempotencyKey,
    inputFingerprint,
    committedRevision: run.revision,
    resultRefs: [
      {
        kind: 'input_snapshot', projectId: ctx.scope.projectId,
        srId: ctx.scope.srId, entityId: run.inputSnapshotId,
      },
      {
        kind: 'generation_run', projectId: ctx.scope.projectId,
        srId: ctx.scope.srId, entityId: run.runId,
      },
    ],
    committedAt,
  };
}

function providerRequestWithinLimit(
  snapshot: Parameters<typeof insertPendingGenerationRun>[1]['snapshot'],
  selection: ProviderSelection,
  maxBytes: number,
): boolean {
  const request: ProviderRequest = {
    schemaVersion: 1,
    taskKind: snapshot.taskKind,
    ...('documentKind' in snapshot ? { documentKind: snapshot.documentKind } : {}),
    snapshot,
    selection,
  };
  return Buffer.byteLength(JSON.stringify(request), 'utf8') <= maxBytes;
}

export function createGenerationService(dependencies: GenerationServiceDependencies): GenerationService {
  const now = dependencies.now ?? (() => new Date().toISOString());

  const readRun = (
    db: DatabaseConnection,
    scope: SrScope,
    runId: string,
  ) => readGenerationRun(db, scope, runId, dependencies.currentInputFingerprints);

  const replayOrConflict = (
    db: DatabaseConnection,
    ctx: GenerationCommand<FingerprintGuard | NoGuard>,
    commandKind: 'M-032' | 'M-034' | 'M-035',
    inputFingerprint: string,
  ): CommandResult<GenerationRunView> | undefined => {
    const stored = readCommandReceipt<GenerationRunView>(db, {
      scope: ctx.scope,
      actorId: ctx.actor.actorId,
      idempotencyKey: ctx.idempotencyKey,
    });
    if (stored === undefined) return undefined;
    if (
      stored.receipt.commandKind !== commandKind ||
      stored.receipt.inputFingerprint !== inputFingerprint
    ) {
      return rejected(
        domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key에 다른 생성 명령이나 입력이 있습니다.'),
        stored.receipt,
      );
    }
    const replayValue = storedReplayRun(stored.replayValue, ctx.scope, commandKind);
    const current = readRun(db, ctx.scope, replayValue.runId);
    if (current === undefined) return rejected(domainError('NOT_FOUND', '명령 결과 생성 실행을 찾을 수 없습니다.'));
    const currentInputFingerprint = dependencies.currentInputFingerprints.readCurrentInputFingerprint(db, {
      projectId: ctx.scope.projectId,
      srId: ctx.scope.srId,
      taskKind: current.taskKind,
      inputSnapshotId: current.inputSnapshotId,
    });
    return {
      kind: 'Replayed',
      value: replayValue,
      receipt: stored.receipt,
      current: runCurrentBasis(current, currentInputFingerprint),
    };
  };

  const mapCommandFailure = <T>(error: unknown): CommandResult<T> => {
    if (
      error instanceof GenerationInputTooLargeError || error instanceof GenerationInputBasisError ||
      error instanceof GenerationProviderRequestTooLargeError
    ) {
      return rejected(domainError('VALIDATION_ERROR', error.message));
    }
    if (error instanceof GenerationPreparationError) {
      if (error.code === 'CORRUPT_DATA') {
        return rejected(domainError('STORE_UNAVAILABLE', '저장된 생성 자료를 안전하게 읽을 수 없습니다.'));
      }
      return rejected(domainError(error.code, error.message));
    }
    if (
      error instanceof GenerationBasisReadError || error instanceof InputSnapshotRepositoryError ||
      error instanceof GenerationRunReadError || error instanceof SyntaxError
    ) return rejected(domainError('STORE_UNAVAILABLE', '저장된 생성 자료를 안전하게 읽을 수 없습니다.'));
    if (isSqliteError(error)) return rejected(domainError('STORE_UNAVAILABLE', '생성 명령을 확정하지 못했습니다.'));
    throw error;
  };

  const createPending = (
    db: DatabaseConnection,
    ctx: GenerationCommand<FingerprintGuard>,
    input: GenerationInput,
    commandKind: 'M-032' | 'M-035',
    inputFingerprint: string,
    retryOfRunId?: string,
  ): CommandResult<GenerationRunView> => {
    const basis = readGenerationBasis(db, ctx.scope);
    if (basis === undefined) return rejected(domainError('NOT_FOUND', '생성 대상 SR을 찾을 수 없습니다.'));
    const prepared = prepareGenerationSnapshot(input, basis, dependencies.projectRules);
    if (ctx.guard.expectedInputFingerprint !== prepared.contentFingerprint) {
      return rejected(domainError(
        'INPUT_CHANGED',
        '현재 생성 입력이 준비한 기준과 달라졌습니다.',
        inputCurrentBasis(ctx.scope, prepared.contentFingerprint),
      ));
    }
    if (countNonterminalGenerationRuns(db) >= dependencies.maxNonterminal) {
      return rejected(domainError('QUEUE_FULL', '생성 대기열이 가득 찼습니다. 진행 중인 작업을 마친 뒤 다시 시도하세요.'));
    }
    const occurredAt = now();
    const snapshot = insertInputSnapshot(db, {
      basis,
      prepared,
      projectRules: dependencies.projectRules,
      capturedAt: occurredAt,
    });
    if (!providerRequestWithinLimit(snapshot, dependencies.selection, dependencies.providerInputBytes)) {
      throw new GenerationProviderRequestTooLargeError(
        `최종 provider 요청은 UTF-8 ${dependencies.providerInputBytes} bytes를 넘을 수 없습니다.`,
      );
    }
    const runId = insertPendingGenerationRun(db, {
      scope: ctx.scope,
      taskKind: input.taskKind,
      snapshot,
      selection: dependencies.selection,
      requestedBy: ctx.actor.actorId,
      requestedAt: occurredAt,
      ...(retryOfRunId === undefined ? {} : { retryOfRunId }),
    });
    const value = readRun(db, ctx.scope, runId);
    if (value === undefined) throw new GenerationRunReadError('저장한 생성 실행을 읽을 수 없습니다.');
    const receipt = receiptFor(ctx, commandKind, inputFingerprint, value, occurredAt);
    storeCommandReceipt(db, { receipt, replayValue: value });
    insertGenerationActivity(db, {
      scope: ctx.scope,
      actorId: ctx.actor.actorId,
      receiptId: receipt.receiptId,
      runId,
      occurredAt,
      eventType: commandKind === 'M-032' ? 'generation_requested' : 'generation_retried',
      description: commandKind === 'M-032' ? '현재 입력으로 생성을 요청했습니다.' : '현재 입력으로 생성을 다시 요청했습니다.',
    });
    return { kind: 'Committed', value, receipt };
  };

  return {
    requestGeneration(ctx, input) {
      const inputFingerprint = commandFingerprint('M-032', ctx, input);
      try {
        return dependencies.persistence.withinTransaction((db) => {
          const authorization = authorizeOwner(db, ctx);
          if (authorization !== undefined) return rejected(authorization);
          const prior = replayOrConflict(db, ctx, 'M-032', inputFingerprint);
          if (prior !== undefined) return prior;
          return createPending(db, ctx, input, 'M-032', inputFingerprint);
        });
      } catch (error) {
        return mapCommandFailure(error);
      }
    },
    getGeneration(ctx, runId) {
      try {
        return dependencies.persistence.readConsistent((db) => {
          const authorization = authorizeMemberScope(db, ctx);
          if (authorization !== undefined) throw new WorkspaceServiceError(authorization);
          const run = readRun(db, ctx.scope, runId);
          if (run === undefined) throw new WorkspaceServiceError(domainError('NOT_FOUND', '생성 실행을 찾을 수 없습니다.'));
          return run;
        });
      } catch (error) {
        if (error instanceof WorkspaceServiceError) throw error;
        if (
          error instanceof GenerationRunReadError || error instanceof InputSnapshotRepositoryError ||
          error instanceof GenerationBasisReadError || isSqliteError(error)
        ) throw new WorkspaceServiceError(domainError('STORE_UNAVAILABLE', '저장된 생성 실행을 안전하게 읽을 수 없습니다.'));
        throw error;
      }
    },
    cancelGeneration(ctx, runId) {
      const inputFingerprint = commandFingerprint('M-034', ctx, runId);
      let committedRunId: string | undefined;
      let result: CommandResult<GenerationRunView>;
      try {
        result = dependencies.persistence.withinTransaction((db) => {
          const authorization = authorizeOwner(db, ctx);
          if (authorization !== undefined) return rejected(authorization);
          const prior = replayOrConflict(db, ctx, 'M-034', inputFingerprint);
          if (prior !== undefined) return prior;
          const before = readRun(db, ctx.scope, runId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', '생성 실행을 찾을 수 없습니다.'));
          if (before.status !== 'pending' && before.status !== 'running') {
            return rejected(domainError('RUN_FINAL', '이미 terminal 상태인 생성 실행은 취소할 수 없습니다.', runCurrentBasis(before)));
          }
          const occurredAt = now();
          if (!cancelGenerationRun(db, { scope: ctx.scope, runId, actorId: ctx.actor.actorId, cancelledAt: occurredAt })) {
            const current = readRun(db, ctx.scope, runId);
            return rejected(domainError(
              'RUN_FINAL',
              '생성 실행의 terminal 상태가 먼저 확정됐습니다.',
              current === undefined ? undefined : runCurrentBasis(current),
            ));
          }
          const value = readRun(db, ctx.scope, runId);
          if (value === undefined) throw new GenerationRunReadError('취소한 생성 실행을 읽을 수 없습니다.');
          const receipt = receiptFor(ctx, 'M-034', inputFingerprint, value, occurredAt);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertGenerationActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            runId,
            occurredAt,
            eventType: 'generation_cancelled',
            description: '생성 취소를 확정했습니다. 프로세스 종료는 별도로 확인합니다.',
          });
          committedRunId = runId;
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return mapCommandFailure(error);
      }
      if (committedRunId !== undefined) {
        try {
          const notification = dependencies.cancellationNotifications?.notifyCancellation(ctx.scope, committedRunId);
          if (notification instanceof Promise) void notification.catch(() => undefined);
        } catch {
          // Cancellation delivery is best effort after the terminal state commits.
        }
      }
      return result;
    },
    retryGeneration(ctx, runId) {
      const inputFingerprint = commandFingerprint('M-035', ctx, runId);
      try {
        return dependencies.persistence.withinTransaction((db) => {
          const authorization = authorizeOwner(db, ctx);
          if (authorization !== undefined) return rejected(authorization);
          const prior = replayOrConflict(db, ctx, 'M-035', inputFingerprint);
          if (prior !== undefined) return prior;
          const preparation = readGenerationPreparation(
            db,
            ctx.scope,
            { kind: 'retry', runId },
            dependencies.projectRules,
          );
          return createPending(
            db,
            ctx,
            preparation.input,
            'M-035',
            inputFingerprint,
            runId,
          );
        });
      } catch (error) {
        return mapCommandFailure(error);
      }
    },
  };
}
