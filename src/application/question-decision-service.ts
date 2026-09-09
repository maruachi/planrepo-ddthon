import { createHash, randomUUID } from 'node:crypto';
import type {
  CommandContext,
  EntityRef,
  RevisionGuard,
  SrScope,
  VersionRef,
} from '@/src/contracts/context';
import type { CommandReceipt, CommandResult, CurrentBasis, DomainError } from '@/src/contracts/results';
import type {
  DecisionConfirmation,
  DecisionConversion,
  DecisionRevision,
  FollowupQuestion,
  QuestionAnswer,
  QuestionResolution,
  ScopeClassification,
  ScopeView,
} from '@/src/contracts/views';
import {
  decodeDecisionReplay,
  decodeQuestionReplay,
  decodeScopeReplay,
  QuestionDecisionReplayError,
} from '@/src/application/question-decision-replay';
import {
  affectedGatesFor,
  validateDecisionConfirmation,
  validateQuestionAnswer,
} from '@/src/domain/question-decision-rules';
import {
  validateDecisionConversion,
  validateDecisionRevision,
  validateQuestionResolution,
} from '@/src/domain/question-decision-policy';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readCommandReceipt, storeCommandReceipt } from '@/src/persistence/command-receipts';
import {
  appendDecisionConfirmation,
  appendDecisionRevision,
  appendQuestionAnswer,
  appendQuestionResolution,
  appendScopeClassification,
  convertQuestionToDecision,
  insertFollowupQuestion,
  insertQuestionDecisionActivity,
  QuestionDecisionRepositoryError,
  readDecisionView,
  readQuestionView,
  readScopeState,
  readScopeView,
  validateScopeReductionBasis,
  type StoredDecisionView,
  type StoredQuestionView,
} from '@/src/persistence/question-decision-repository';
import { applyVersionReviewImpact } from '@/src/persistence/review-impact-repository';
import { readMembership, readSrOwner, readSrView } from '@/src/persistence/sr-repository';
import type { Persistence } from '@/src/persistence/transaction';

export type AnswerQuestionCommand = CommandContext<SrScope, RevisionGuard<'question'>>;
export type ResolveQuestionCommand = CommandContext<SrScope, RevisionGuard<'question'>>;
export type AddFollowupQuestionCommand = CommandContext<SrScope, RevisionGuard<'question'>>;
export type ConvertQuestionCommand = CommandContext<SrScope, RevisionGuard<'question'>>;
export type ConfirmDecisionCommand = CommandContext<SrScope, RevisionGuard<'decision'>>;
export type RedecideCommand = CommandContext<SrScope, RevisionGuard<'decision'>>;
export type ClassifyScopeCommand = CommandContext<SrScope, RevisionGuard<'question' | 'decision'>>;
type QuestionCommand = AnswerQuestionCommand | ResolveQuestionCommand | AddFollowupQuestionCommand | ConvertQuestionCommand;
type DecisionCommand = ConfirmDecisionCommand | RedecideCommand;
type AnyQuestionDecisionCommand = QuestionCommand | DecisionCommand | ClassifyScopeCommand;

export interface QuestionDecisionService {
  answerQuestion(ctx: AnswerQuestionCommand, input: QuestionAnswer): CommandResult<StoredQuestionView>;
  resolveQuestion(ctx: ResolveQuestionCommand, input: QuestionResolution): CommandResult<StoredQuestionView>;
  addFollowupQuestion(ctx: AddFollowupQuestionCommand, input: FollowupQuestion): CommandResult<StoredQuestionView>;
  convertQuestionToDecision(ctx: ConvertQuestionCommand, input: DecisionConversion): CommandResult<StoredDecisionView>;
  confirmDecision(ctx: ConfirmDecisionCommand, input: DecisionConfirmation): CommandResult<StoredDecisionView>;
  redecide(ctx: RedecideCommand, input: DecisionRevision): CommandResult<StoredDecisionView>;
  classifyScope(ctx: ClassifyScopeCommand, input: ScopeClassification): CommandResult<ScopeView>;
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

function rejected<T>(error: DomainError): CommandResult<T> {
  return { kind: 'Rejected', error };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new TypeError('명령 입력은 JSON 값이어야 합니다.');
  return result;
}

function commandFingerprint(
  commandKind: 'M-008' | 'M-009' | 'M-010' | 'M-011' | 'M-012' | 'M-013' | 'M-014',
  ctx: AnyQuestionDecisionCommand,
  input: QuestionAnswer | QuestionResolution | FollowupQuestion | DecisionConversion | DecisionConfirmation | DecisionRevision | ScopeClassification,
): string {
  return `sha256:${createHash('sha256').update(canonical({
    schemaVersion: 1,
    commandKind,
    scope: ctx.scope,
    guard: ctx.guard,
    input,
  })).digest('hex')}`;
}

function questionBasis(view: StoredQuestionView): CurrentBasis {
  return {
    target: { kind: 'question', projectId: view.scope.projectId, srId: view.scope.srId, entityId: view.questionId },
    currentRevision: view.revision,
    allowedActions: view.allowedActions,
  };
}

function decisionBasis(view: StoredDecisionView): CurrentBasis {
  return {
    target: { kind: 'decision', projectId: view.scope.projectId, srId: view.scope.srId, entityId: view.decisionId },
    currentRevision: view.revision,
    allowedActions: view.allowedActions,
  };
}

function scopeBasis(view: ScopeView): CurrentBasis {
  return {
    target: view.targetRef,
    currentRevision: view.revision,
    allowedActions: [],
  };
}

function validateContext(ctx: AnyQuestionDecisionCommand): DomainError | undefined {
  return ctx.actor.projectId === ctx.scope.projectId
    ? undefined
    : domainError('FORBIDDEN', 'actor와 요청 프로젝트가 다릅니다.');
}

function validateGuard<K extends 'question' | 'decision'>(
  ctx: CommandContext<SrScope, RevisionGuard<K>>,
  kind: K,
  entityId: string,
  currentRevision: number,
  current: CurrentBasis,
): DomainError | undefined {
  const target = ctx.guard.resource.target;
  if (
    target.kind !== kind || target.projectId !== ctx.scope.projectId ||
    target.srId !== ctx.scope.srId || target.entityId !== entityId
  ) return domainError('VALIDATION_ERROR', 'guard 대상이 명령 대상과 다릅니다.', current);
  return ctx.guard.resource.expectedRevision === currentRevision
    ? undefined
    : domainError('STALE_VERSION', '대상 revision이 이미 바뀌었습니다.', current);
}

function decodeReplayValue<T extends StoredQuestionView | StoredDecisionView>(
  value: unknown,
  ctx: QuestionCommand | DecisionCommand,
  commandKind: 'M-008' | 'M-009' | 'M-010' | 'M-011' | 'M-012' | 'M-013',
): T {
  return (commandKind === 'M-011' || commandKind === 'M-012' || commandKind === 'M-013'
    ? decodeDecisionReplay(value, ctx.scope)
    : decodeQuestionReplay(value, ctx.scope)) as T;
}

function readReplay<T extends StoredQuestionView | StoredDecisionView>(
  db: DatabaseConnection,
  ctx: QuestionCommand | DecisionCommand,
  commandKind: 'M-008' | 'M-009' | 'M-010' | 'M-011' | 'M-012' | 'M-013',
  inputFingerprint: string,
  readCurrent: (value: T) => T | undefined,
  basis: (value: T) => CurrentBasis,
): CommandResult<T> | undefined {
  let stored;
  try {
    stored = readCommandReceipt<unknown>(db, {
      scope: ctx.scope,
      actorId: ctx.actor.actorId,
      idempotencyKey: ctx.idempotencyKey,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new QuestionDecisionRepositoryError('CORRUPT_DATA', 'command receipt JSON이 올바르지 않습니다.');
    }
    throw error;
  }
  if (stored === undefined) return undefined;
  if (stored.receipt.commandKind !== commandKind || stored.receipt.inputFingerprint !== inputFingerprint) {
    return {
      kind: 'Rejected',
      error: domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key에 다른 명령이나 입력이 있습니다.'),
      priorReceipt: stored.receipt,
    };
  }
  const replayValue = decodeReplayValue<T>(stored.replayValue, ctx, commandKind);
  const current = readCurrent(replayValue);
  if (current === undefined) return rejected(domainError('NOT_FOUND', '명령 결과의 현재 대상을 찾을 수 없습니다.'));
  return { kind: 'Replayed', value: replayValue, receipt: stored.receipt, current: basis(current) };
}

function readScopeReplay(
  db: DatabaseConnection,
  ctx: ClassifyScopeCommand,
  inputFingerprint: string,
): CommandResult<ScopeView> | undefined {
  let stored;
  try {
    stored = readCommandReceipt<unknown>(db, {
      scope: ctx.scope,
      actorId: ctx.actor.actorId,
      idempotencyKey: ctx.idempotencyKey,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new QuestionDecisionRepositoryError('CORRUPT_DATA', 'command receipt JSON이 올바르지 않습니다.');
    }
    throw error;
  }
  if (stored === undefined) return undefined;
  if (stored.receipt.commandKind !== 'M-014' || stored.receipt.inputFingerprint !== inputFingerprint) {
    return {
      kind: 'Rejected',
      error: domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key에 다른 명령이나 입력이 있습니다.'),
      priorReceipt: stored.receipt,
    };
  }
  const replay = decodeScopeReplay(stored.replayValue, ctx.scope);
  const ref = replay.targetRef;
  const current = readScopeView(db, ctx.scope, {
    kind: ref.kind, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: ref.entityId,
  });
  if (current === undefined) return rejected(domainError('NOT_FOUND', '분류 결과의 현재 대상을 찾을 수 없습니다.'));
  return { kind: 'Replayed', value: replay, receipt: stored.receipt, current: scopeBasis(current) };
}

function receiptFor<T extends { readonly revision: number }>(
  ctx: AnyQuestionDecisionCommand,
  commandKind: 'M-008' | 'M-009' | 'M-010' | 'M-011' | 'M-012' | 'M-013' | 'M-014',
  inputFingerprint: string,
  value: T,
  resultRefs: readonly (EntityRef | VersionRef)[],
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
    committedRevision: value.revision,
    resultRefs,
    committedAt,
  };
}

function memberError(db: DatabaseConnection, ctx: AnyQuestionDecisionCommand): DomainError | undefined {
  return readMembership(db, ctx.scope.projectId, ctx.actor.actorId) === undefined
    ? domainError('FORBIDDEN', '현재 프로젝트 member만 이 명령을 실행할 수 있습니다.')
    : undefined;
}

function repositoryFailure<T>(error: unknown): CommandResult<T> {
  if (error instanceof QuestionDecisionRepositoryError || error instanceof QuestionDecisionReplayError) {
    if (error instanceof QuestionDecisionReplayError) {
      return rejected(domainError('STORE_UNAVAILABLE', '저장된 질문또는 decision을 해석하지 못했습니다.'));
    }
    if (error.code === 'INVALID_INPUT') return rejected(domainError('VALIDATION_ERROR', error.message));
    return rejected(domainError('STORE_UNAVAILABLE', '저장된 질문또는 decision을 해석하지 못했습니다.'));
  }
  if (
    typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && error.code.startsWith('SQLITE_')
  ) return rejected(domainError('STORE_UNAVAILABLE', '저장소에서 명령을 확정하지 못했습니다.'));
  throw error;
}

export function createQuestionDecisionService(persistence: Persistence): QuestionDecisionService {
  return {
    answerQuestion(ctx, input) {
      const inputFingerprint = commandFingerprint('M-008', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const membershipError = memberError(db, ctx);
          if (membershipError !== undefined) return rejected(membershipError);
          const before = readQuestionView(db, ctx.scope, input.questionId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', '질문을 찾을 수 없습니다.'));
          if (before.assigneeId !== ctx.actor.actorId) {
            return rejected(domainError('NOT_ASSIGNED', '현재 질문 담당자만 답변할 수 있습니다.', questionBasis(before)));
          }
          const replay = readReplay<StoredQuestionView>(db, ctx, 'M-008', inputFingerprint,
            (value) => readQuestionView(db, value.scope, value.questionId), questionBasis);
          if (replay !== undefined) return replay;
          const guardError = validateGuard(ctx, 'question', input.questionId, before.revision, questionBasis(before));
          if (guardError !== undefined) return rejected(guardError);
          const validationError = validateQuestionAnswer(before, input);
          if (validationError !== undefined) return rejected(domainError('VALIDATION_ERROR', validationError, questionBasis(before)));
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const now = new Date().toISOString();
          const refs = appendQuestionAnswer(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            occurredAt: now,
            value: input,
            currentResultVersion: before.currentResult.ref.version,
          });
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef: refs.resultRef,
            affectedGates: affectedGatesFor(before.requiredGate),
            reason: '질문에 답변해 현재 검토 기준을 갱신합니다.',
            occurredAt: now,
            incrementSrRevision: true,
          });
          const value = readQuestionView(db, ctx.scope, input.questionId, impact.reviewImpact);
          if (value === undefined) throw new Error('저장한 질문을 읽을 수 없습니다.');
          const target = { kind: 'question' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.questionId };
          const receipt = receiptFor(ctx, 'M-008', inputFingerprint, value, [target, refs.answerRef, refs.resultRef], now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertQuestionDecisionActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt: now,
            eventType: 'question_answered',
            description: '질문에 답변했습니다.',
            targetRefs: [target, refs.answerRef, refs.resultRef],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return repositoryFailure(error);
      }
    },

    resolveQuestion(ctx, input) {
      const inputFingerprint = commandFingerprint('M-009', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const membershipError = memberError(db, ctx);
          if (membershipError !== undefined) return rejected(membershipError);
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const before = readQuestionView(db, ctx.scope, input.questionId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', '질문을 찾을 수 없습니다.'));
          if (ownerId !== ctx.actor.actorId) {
            return rejected(domainError('NOT_ASSIGNED', 'SR owner만 질문 해결을 확인할 수 있습니다.', questionBasis(before)));
          }
          const replay = readReplay<StoredQuestionView>(db, ctx, 'M-009', inputFingerprint,
            (value) => readQuestionView(db, value.scope, value.questionId), questionBasis);
          if (replay !== undefined) return replay;
          const guardError = validateGuard(ctx, 'question', input.questionId, before.revision, questionBasis(before));
          if (guardError !== undefined) return rejected(guardError);
          const validationError = validateQuestionResolution(before, input);
          if (validationError !== undefined) {
            return rejected(domainError('VALIDATION_ERROR', validationError, questionBasis(before)));
          }
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const now = new Date().toISOString();
          const resultRef = appendQuestionResolution(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            occurredAt: now,
            value: input,
            currentResultVersion: before.currentResult.ref.version,
          });
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef: resultRef,
            affectedGates: affectedGatesFor(before.requiredGate),
            reason: '질문의 특정 답변과 문서 반영 여부를 해결 확인했습니다.',
            occurredAt: now,
            incrementSrRevision: true,
          });
          const value = readQuestionView(db, ctx.scope, input.questionId, impact.reviewImpact);
          if (value === undefined) throw new Error('해결한 질문을 읽을 수 없습니다.');
          const target = {
            kind: 'question' as const, projectId: ctx.scope.projectId,
            srId: ctx.scope.srId, entityId: input.questionId,
          };
          const receipt = receiptFor(ctx, 'M-009', inputFingerprint, value, [target, input.selectedAnswerRef, resultRef], now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertQuestionDecisionActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt: now,
            eventType: 'question_resolved',
            description: '질문 해결을 확인했습니다.',
            targetRefs: [target, input.selectedAnswerRef, resultRef],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return repositoryFailure(error);
      }
    },

    addFollowupQuestion(ctx, input) {
      const inputFingerprint = commandFingerprint('M-010', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const membershipError = memberError(db, ctx);
          if (membershipError !== undefined) return rejected(membershipError);
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          if (ownerId !== ctx.actor.actorId) return rejected(domainError('NOT_ASSIGNED', 'SR owner만 후속 질문을 등록할 수 있습니다.'));
          const parent = readQuestionView(db, ctx.scope, input.parentQuestionId);
          if (parent === undefined) return rejected(domainError('NOT_FOUND', '부모 질문을 찾을 수 없습니다.'));
          const replay = readReplay<StoredQuestionView>(db, ctx, 'M-010', inputFingerprint,
            (value) => readQuestionView(db, value.scope, value.questionId), questionBasis);
          if (replay !== undefined) return replay;
          const guardError = validateGuard(ctx, 'question', input.parentQuestionId, parent.revision, questionBasis(parent));
          if (guardError !== undefined) return rejected(guardError);
          if (readMembership(db, ctx.scope.projectId, input.assigneeId) === undefined) {
            return rejected(domainError('NOT_FOUND', '지정한 질문 담당자가 현재 프로젝트 member가 아닙니다.'));
          }
          if (input.classification.scope === 'followup' &&
            readMembership(db, ctx.scope.projectId, input.classification.ownerId) === undefined) {
            return rejected(domainError('NOT_FOUND', '후속 범위 owner가 현재 프로젝트 member가 아닙니다.'));
          }
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const now = new Date().toISOString();
          const created = insertFollowupQuestion(db, { scope: ctx.scope, actorId: ctx.actor.actorId, occurredAt: now, value: input });
          const initial = readQuestionView(db, ctx.scope, created.entityId);
          if (initial === undefined) throw new Error('저장한 후속 질문을 읽을 수 없습니다.');
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef: initial.currentResult.ref,
            affectedGates: affectedGatesFor(input.classification.requiredGate),
            reason: '후속 질문을 등록해 해당 검토 기준을 갱신합니다.',
            occurredAt: now,
            incrementSrRevision: true,
          });
          const value = readQuestionView(db, ctx.scope, created.entityId, impact.reviewImpact);
          if (value === undefined) throw new Error('저장한 후속 질문을 읽을 수 없습니다.');
          const receipt = receiptFor(ctx, 'M-010', inputFingerprint, value, [created, value.currentResult.ref], now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertQuestionDecisionActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt: now,
            eventType: 'followup_question_added',
            description: '후속 질문을 등록했습니다.',
            targetRefs: [created, value.currentResult.ref],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return repositoryFailure(error);
      }
    },

    convertQuestionToDecision(ctx, input) {
      const inputFingerprint = commandFingerprint('M-011', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const membershipError = memberError(db, ctx);
          if (membershipError !== undefined) return rejected(membershipError);
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const before = readQuestionView(db, ctx.scope, input.questionId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', '질문을 찾을 수 없습니다.'));
          if (ownerId !== ctx.actor.actorId) {
            return rejected(domainError('NOT_ASSIGNED', 'SR owner만 질문을 decision으로 전환할 수 있습니다.', questionBasis(before)));
          }
          const replay = readReplay<StoredDecisionView>(db, ctx, 'M-011', inputFingerprint,
            (value) => readDecisionView(db, value.scope, value.decisionId), decisionBasis);
          if (replay !== undefined) return replay;
          const guardError = validateGuard(ctx, 'question', input.questionId, before.revision, questionBasis(before));
          if (guardError !== undefined) return rejected(guardError);
          const validationError = validateDecisionConversion(before, input);
          if (validationError !== undefined) {
            return rejected(domainError('VALIDATION_ERROR', validationError, questionBasis(before)));
          }
          if (readMembership(db, ctx.scope.projectId, input.decisionMakerId) === undefined) {
            return rejected(domainError('NOT_FOUND', '지정 decision maker가 현재 프로젝트 member가 아닙니다.'));
          }
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const now = new Date().toISOString();
          const refs = convertQuestionToDecision(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            occurredAt: now,
            value: input,
            currentResultVersion: before.currentResult.ref.version,
            requiredGate: before.requiredGate,
          });
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef: refs.resultRef,
            affectedGates: affectedGatesFor(before.requiredGate),
            reason: '질문을 연결된 미확정 decision으로 전환했습니다.',
            occurredAt: now,
            incrementSrRevision: true,
          });
          const value = readDecisionView(db, ctx.scope, refs.decisionRef.entityId, impact.reviewImpact);
          if (value === undefined) throw new Error('전환한 decision을 읽을 수 없습니다.');
          const receipt = receiptFor(ctx, 'M-011', inputFingerprint, value,
            [refs.decisionRef, refs.resultRef, refs.classificationRef, input.classificationRef], now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertQuestionDecisionActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt: now,
            eventType: 'question_converted',
            description: '질문을 decision으로 전환했습니다.',
            targetRefs: [refs.decisionRef, refs.resultRef, refs.classificationRef, input.classificationRef],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return repositoryFailure(error);
      }
    },

    confirmDecision(ctx, input) {
      const inputFingerprint = commandFingerprint('M-012', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const membershipError = memberError(db, ctx);
          if (membershipError !== undefined) return rejected(membershipError);
          const before = readDecisionView(db, ctx.scope, input.decisionId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', 'decision을 찾을 수 없습니다.'));
          if (before.decisionMakerId !== ctx.actor.actorId) {
            return rejected(domainError('NOT_ASSIGNED', '지정 decision maker만 확정할 수 있습니다.', decisionBasis(before)));
          }
          const replay = readReplay<StoredDecisionView>(db, ctx, 'M-012', inputFingerprint,
            (value) => readDecisionView(db, value.scope, value.decisionId), decisionBasis);
          if (replay !== undefined) return replay;
          const guardError = validateGuard(ctx, 'decision', input.decisionId, before.revision, decisionBasis(before));
          if (guardError !== undefined) return rejected(guardError);
          const validationError = validateDecisionConfirmation(before, input);
          if (validationError !== undefined) return rejected(domainError('VALIDATION_ERROR', validationError, decisionBasis(before)));
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const now = new Date().toISOString();
          const versionRef = appendDecisionConfirmation(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            occurredAt: now,
            value: input,
          });
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef: versionRef,
            affectedGates: affectedGatesFor(before.requiredGate),
            reason: 'decision을 확정해 현재 검토 기준을 갱신합니다.',
            occurredAt: now,
            incrementSrRevision: true,
          });
          const value = readDecisionView(db, ctx.scope, input.decisionId, impact.reviewImpact);
          if (value === undefined) throw new Error('저장한 decision을 읽을 수 없습니다.');
          const target = { kind: 'decision' as const, projectId: ctx.scope.projectId, srId: ctx.scope.srId, entityId: value.decisionId };
          const receipt = receiptFor(ctx, 'M-012', inputFingerprint, value, [target, versionRef], now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertQuestionDecisionActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt: now,
            eventType: 'decision_confirmed',
            description: 'decision을 확정했습니다.',
            targetRefs: [target, versionRef],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return repositoryFailure(error);
      }
    },

    redecide(ctx, input) {
      const inputFingerprint = commandFingerprint('M-013', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const membershipError = memberError(db, ctx);
          if (membershipError !== undefined) return rejected(membershipError);
          const before = readDecisionView(db, ctx.scope, input.decisionId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', 'decision을 찾을 수 없습니다.'));
          if (before.decisionMakerId !== ctx.actor.actorId) {
            return rejected(domainError('NOT_ASSIGNED', '지정 decision maker만 재결정할 수 있습니다.', decisionBasis(before)));
          }
          const replay = readReplay<StoredDecisionView>(db, ctx, 'M-013', inputFingerprint,
            (value) => readDecisionView(db, value.scope, value.decisionId), decisionBasis);
          if (replay !== undefined) return replay;
          const guardError = validateGuard(ctx, 'decision', input.decisionId, before.revision, decisionBasis(before));
          if (guardError !== undefined) return rejected(guardError);
          const validationError = validateDecisionRevision(before, input);
          if (validationError !== undefined) {
            return rejected(domainError('VALIDATION_ERROR', validationError, decisionBasis(before)));
          }
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined || before.currentConfirmation === undefined) {
            return rejected(domainError('NOT_FOUND', '현재 decision version을 찾을 수 없습니다.'));
          }
          const now = new Date().toISOString();
          const versionRef = appendDecisionRevision(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            occurredAt: now,
            value: input,
            currentVersion: before.currentConfirmation.ref.version,
          });
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef: versionRef,
            affectedGates: affectedGatesFor(before.requiredGate),
            reason: 'decision을 재결정해 현재 검토 기준을 갱신합니다.',
            occurredAt: now,
            incrementSrRevision: true,
          });
          const value = readDecisionView(db, ctx.scope, input.decisionId, impact.reviewImpact);
          if (value === undefined) throw new Error('재결정한 decision을 읽을 수 없습니다.');
          const target = {
            kind: 'decision' as const, projectId: ctx.scope.projectId,
            srId: ctx.scope.srId, entityId: value.decisionId,
          };
          const receipt = receiptFor(ctx, 'M-013', inputFingerprint, value, [target, versionRef], now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertQuestionDecisionActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt: now,
            eventType: 'decision_revised',
            description: 'decision을 재결정했습니다.',
            targetRefs: [target, versionRef],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return repositoryFailure(error);
      }
    },

    classifyScope(ctx, input) {
      const inputFingerprint = commandFingerprint('M-014', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const membershipError = memberError(db, ctx);
          if (membershipError !== undefined) return rejected(membershipError);
          if (input.targetRef.projectId !== ctx.scope.projectId || input.targetRef.srId !== ctx.scope.srId) {
            return rejected(domainError('VALIDATION_ERROR', '분류 대상 scope가 요청과 다릅니다.'));
          }
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const targetView = input.targetRef.kind === 'question'
            ? readQuestionView(db, ctx.scope, input.targetRef.entityId)
            : readDecisionView(db, ctx.scope, input.targetRef.entityId);
          if (targetView === undefined) return rejected(domainError('NOT_FOUND', '분류 대상을 찾을 수 없습니다.'));
          const currentBasis = input.targetRef.kind === 'question'
            ? questionBasis(targetView as StoredQuestionView)
            : decisionBasis(targetView as StoredDecisionView);
          if (ownerId !== ctx.actor.actorId) {
            return rejected(domainError('NOT_ASSIGNED', 'SR owner만 범위를 분류할 수 있습니다.', currentBasis));
          }
          const replay = readScopeReplay(db, ctx, inputFingerprint);
          if (replay !== undefined) return replay;
          if (input.targetRef.kind === 'question' &&
            (targetView as StoredQuestionView).status === 'converted_to_decision') {
            return rejected(domainError(
              'VALIDATION_ERROR',
              '전환된 질문의 범위는 연결 decision에서 변경해야 합니다.',
              currentBasis,
            ));
          }
          const guardTarget = ctx.guard.resource.target;
          if (guardTarget.kind !== input.targetRef.kind || guardTarget.projectId !== ctx.scope.projectId ||
            guardTarget.srId !== ctx.scope.srId || guardTarget.entityId !== input.targetRef.entityId) {
            return rejected(domainError('VALIDATION_ERROR', 'guard 대상이 분류 대상과 다릅니다.', currentBasis));
          }
          if (ctx.guard.resource.expectedRevision !== targetView.revision) {
            return rejected(domainError('STALE_VERSION', '대상 revision이 이미 바뀌었습니다.', currentBasis));
          }
          const before = readScopeState(db, ctx.scope, input.targetRef);
          if (before === undefined) return rejected(domainError('NOT_FOUND', '현재 범위 분류를 찾을 수 없습니다.'));
          if (before.scope === 'current' && input.scope === 'followup') {
            validateScopeReductionBasis(db, ctx.scope, input.basisRefs);
          }
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const now = new Date().toISOString();
          const changed = appendScopeClassification(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            occurredAt: now,
            value: input,
            before,
          });
          const affected = new Set([
            ...(before.scope === 'current' ? affectedGatesFor(before.requiredGate) : []),
            ...(input.scope === 'current' ? affectedGatesFor(input.requiredGate) : []),
          ]);
          const affectedGates = (['G1', 'G2'] as const).filter((gate) => affected.has(gate));
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef: changed.classificationRef,
            affectedGates,
            reason: '질문 또는 decision의 범위 분류를 변경했습니다.',
            occurredAt: now,
            incrementSrRevision: true,
          });
          const value = readScopeView(db, ctx.scope, input.targetRef, impact.reviewImpact);
          if (value === undefined) throw new Error('변경한 범위 분류를 읽을 수 없습니다.');
          const resultRefs = [
            input.targetRef,
            changed.classificationRef,
            ...(changed.questionResultRef === undefined ? [] : [changed.questionResultRef]),
          ];
          const receipt = receiptFor(ctx, 'M-014', inputFingerprint, value, resultRefs, now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertQuestionDecisionActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt: now,
            eventType: 'scope_classified',
            description: '범위 분류를 변경했습니다.',
            targetRefs: resultRefs,
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return repositoryFailure(error);
      }
    },
  };
}
