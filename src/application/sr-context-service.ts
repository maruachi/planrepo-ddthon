import { createHash, randomUUID } from 'node:crypto';
import type {
  ContextSourceVersionRef,
  CommandContext,
  NoGuard,
  ProjectScope,
  RevisionAndBundleGuard,
  RevisionGuard,
  SrScope,
} from '@/src/contracts/context';
import type { CommandResult, CurrentBasis, DomainError } from '@/src/contracts/results';
import type {
  ContextSourceView,
  ImportOutcome,
  NewSR,
  SourceConfirmation,
  SourceInput,
  SRDescriptionEdit,
  SRView,
  StageTransition,
  TicketKey,
} from '@/src/contracts/views';
import {
  requireMemberOwner,
  requireProjectMember,
  requireSrOwner,
} from '@/src/domain/authorization';
import type { Persistence } from '@/src/persistence/transaction';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readCommandReceipt, storeCommandReceipt } from '@/src/persistence/command-receipts';
import {
  findSrIdByEitherKey,
  insertSrGraph,
  readMembership,
  readSrOwner,
  readSrView,
  transitionReceivedSr,
  updateDescription,
} from '@/src/persistence/sr-repository';
import { applyDescriptionReviewImpact } from '@/src/persistence/review-impact-repository';
import { applyContextSourceReviewImpact } from '@/src/persistence/review-impact-repository';
import {
  confirmContextSource,
  ContextSourceRepositoryError,
  insertUnconfirmedContextSource,
  readContextSource,
  toContextSourceView,
} from '@/src/persistence/context-source-repository';
import type { MockTicket, MockTicketProvider } from '@/src/providers/reference/mock-ticket-provider';

type ProjectCommand = CommandContext<ProjectScope, NoGuard>;
type DescriptionCommand = CommandContext<SrScope, RevisionGuard<'sr'>>;
type TransitionCommand = CommandContext<
  SrScope,
  RevisionGuard<'sr'> | RevisionAndBundleGuard<'sr'>
>;
type SourceAttachCommand = CommandContext<SrScope, RevisionGuard<'sr'>>;
type SourceConfirmCommand = CommandContext<SrScope, RevisionGuard<'context_source'>>;
type SrCommand = DescriptionCommand | TransitionCommand | SourceAttachCommand | SourceConfirmCommand;

function domainError(
  code: DomainError['code'],
  message: string,
  current?: CurrentBasis,
): DomainError {
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

function storeFailure<T>(): CommandResult<T> {
  return rejected(domainError('STORE_UNAVAILABLE', '저장소에서 명령을 확정하지 못했습니다.'));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function commandFingerprint(
  commandKind: 'M-003' | 'M-004' | 'M-005' | 'M-006' | 'M-007' | 'M-028',
  ctx: ProjectCommand | SrCommand,
  input: unknown,
): string {
  return fingerprint({
    schemaVersion: 1,
    commandKind,
    scope: ctx.scope,
    guard: ctx.guard,
    input,
  });
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeNewSr(input: NewSR): NewSR {
  return {
    key: normalizeText(input.key),
    title: normalizeText(input.title),
    purpose: normalizeText(input.purpose),
    description: input.description,
    ownerId: normalizeText(input.ownerId),
    ...(input.existingSystem === undefined ? {} : { existingSystem: input.existingSystem }),
  };
}

function normalizeDescription(input: SRDescriptionEdit): SRDescriptionEdit {
  return {
    title: normalizeText(input.title),
    purpose: normalizeText(input.purpose),
    description: input.description,
    changeReason: normalizeText(input.changeReason),
  };
}

function validateRequiredStrings(values: readonly string[]): boolean {
  return values.every((value) => value.trim().length > 0);
}

function currentBasis(sr: SRView): CurrentBasis {
  return {
    target: {
      kind: 'sr',
      projectId: sr.scope.projectId,
      srId: sr.scope.srId,
      entityId: sr.scope.srId,
    },
    currentRevision: sr.revision,
    allowedActions: [],
  };
}

function currentSourceBasis(source: Pick<
  ContextSourceView,
  'scope' | 'sourceId' | 'currentVersionRef' | 'revision'
>): CurrentBasis {
  return {
    target: {
      kind: 'context_source',
      projectId: source.scope.projectId,
      srId: source.scope.srId,
      entityId: source.sourceId,
    },
    currentRevision: source.revision,
    allowedActions: [],
  };
}

function receiptFor(
  command: ProjectCommand | DescriptionCommand | TransitionCommand,
  commandKind: string,
  inputFingerprint: string,
  value: SRView | ImportOutcome,
  sr: SRView,
  committedAt: string,
) {
  return {
    scope: command.scope,
    receiptId: `receipt-${randomUUID()}`,
    actorRef: {
      actorId: command.actor.actorId,
      projectId: command.scope.projectId,
    },
    commandKind,
    requestId: command.requestId,
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    committedRevision: sr.revision,
    resultRefs: [
      {
        kind: 'sr' as const,
        projectId: sr.scope.projectId,
        srId: sr.scope.srId,
        entityId: sr.scope.srId,
      },
      sr.currentDescriptionRef,
    ],
    committedAt,
    value,
  };
}

function sourceReceiptFor(
  command: SourceAttachCommand | SourceConfirmCommand,
  commandKind: 'M-006' | 'M-007',
  inputFingerprint: string,
  value: ContextSourceView,
  committedAt: string,
) {
  return {
    scope: command.scope,
    receiptId: `receipt-${randomUUID()}`,
    actorRef: { actorId: command.actor.actorId, projectId: command.scope.projectId },
    commandKind,
    requestId: command.requestId,
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    committedRevision: value.revision,
    resultRefs: [
      {
        kind: 'context_source' as const,
        projectId: value.scope.projectId,
        srId: value.scope.srId,
        entityId: value.sourceId,
      },
      value.currentVersionRef,
    ],
    committedAt,
  };
}

function insertActivity(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly receiptId: string;
    readonly eventType: string;
    readonly occurredAt: string;
    readonly description: string;
    readonly targetRefs?: readonly object[];
  },
): void {
  db.prepare(
    `INSERT INTO activity_events(
       project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,
       occurred_at,receipt_id,internal_basis_json,description,payload_json
     ) VALUES (?,?,?,?,'user',?,?,?, ?,NULL,?,'{}')`,
  ).run(
    input.projectId,
    `activity-${randomUUID()}`,
    input.srId,
    input.eventType,
    input.actorId,
    JSON.stringify(input.targetRefs ?? [{
      kind: 'sr', projectId: input.projectId, srId: input.srId, entityId: input.srId,
    }]),
    input.occurredAt,
    input.receiptId,
    input.description,
  );
}

function validateProjectContext(ctx: ProjectCommand): DomainError | undefined {
  return ctx.actor.projectId === ctx.scope.projectId
    ? undefined
    : domainError('FORBIDDEN', 'actor와 요청 프로젝트가 다릅니다.');
}

function validateSrContext(
  ctx: SrCommand,
): DomainError | undefined {
  return ctx.actor.projectId === ctx.scope.projectId
    ? undefined
    : domainError('FORBIDDEN', 'actor와 요청 프로젝트가 다릅니다.');
}

function revisionError(
  ctx: DescriptionCommand | TransitionCommand | SourceAttachCommand,
  sr: SRView,
): DomainError | undefined {
  const guard = ctx.guard;
  if (!('resource' in guard)) {
    return domainError('GATE_BLOCKED', 'SR 변경에는 revision 기준이 필요합니다.', currentBasis(sr));
  }
  const resource = guard.resource;
  if (
    resource.target.kind !== 'sr' ||
    resource.target.projectId !== ctx.scope.projectId ||
    resource.target.srId !== ctx.scope.srId ||
    resource.target.entityId !== ctx.scope.srId
  ) return domainError('VALIDATION_ERROR', 'guard 대상이 현재 SR과 다릅니다.', currentBasis(sr));
  return resource.expectedRevision === sr.revision
    ? undefined
    : domainError('STALE_VERSION', 'SR revision이 이미 바뀌었습니다.', currentBasis(sr));
}

function sourceRevisionError(
  ctx: SourceConfirmCommand,
  requestedRef: ContextSourceVersionRef,
  source: Pick<ContextSourceView, 'scope' | 'sourceId' | 'currentVersionRef' | 'revision'>,
): DomainError | undefined {
  const resource = ctx.guard.resource;
  if (
    requestedRef.projectId !== ctx.scope.projectId ||
    requestedRef.srId !== ctx.scope.srId ||
    resource.target.kind !== 'context_source' ||
    resource.target.projectId !== ctx.scope.projectId ||
    resource.target.srId !== ctx.scope.srId ||
    resource.target.entityId !== requestedRef.entityId
  ) return domainError('VALIDATION_ERROR', 'guard와 source version 대상이 현재 SR 자료와 다릅니다.', currentSourceBasis(source));
  if (
    requestedRef.version !== source.currentVersionRef.version ||
    resource.expectedRevision !== source.revision
  ) return domainError('STALE_VERSION', '자료의 현재 revision 또는 version이 이미 바뀌었습니다.', currentSourceBasis(source));
  return undefined;
}

function replayOrConflict<T extends SRView | ImportOutcome>(
  db: DatabaseConnection,
  ctx: ProjectCommand | DescriptionCommand | TransitionCommand,
  commandKind: string,
  inputFingerprint: string,
): CommandResult<T> | undefined {
  const stored = readCommandReceipt<T>(db, {
    scope: ctx.scope,
    actorId: ctx.actor.actorId,
    idempotencyKey: ctx.idempotencyKey,
  });
  if (stored === undefined) return undefined;
  if (
    stored.receipt.commandKind !== commandKind ||
    stored.receipt.inputFingerprint !== inputFingerprint
  ) {
    return {
      kind: 'Rejected',
      error: domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key에 다른 명령이나 입력이 있습니다.'),
      priorReceipt: stored.receipt,
    };
  }
  const replayValue: SRView | ImportOutcome = stored.replayValue;
  const resultSr = 'kind' in replayValue ? replayValue.sr : replayValue;
  const current = readSrView(db, resultSr.scope.projectId, resultSr.scope.srId);
  if (current === undefined) return rejected(domainError('NOT_FOUND', '명령 결과 SR을 찾을 수 없습니다.'));
  return {
    kind: 'Replayed',
    value: stored.replayValue,
    receipt: stored.receipt,
    current: currentBasis(current),
  };
}

function replaySourceOrConflict(
  db: DatabaseConnection,
  ctx: SourceAttachCommand | SourceConfirmCommand,
  commandKind: 'M-006' | 'M-007',
  inputFingerprint: string,
): CommandResult<ContextSourceView> | undefined {
  const stored = readCommandReceipt<ContextSourceView>(db, {
    scope: ctx.scope,
    actorId: ctx.actor.actorId,
    idempotencyKey: ctx.idempotencyKey,
  });
  if (stored === undefined) return undefined;
  if (
    stored.receipt.commandKind !== commandKind ||
    stored.receipt.inputFingerprint !== inputFingerprint
  ) {
    return {
      kind: 'Rejected',
      error: domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key에 다른 명령이나 입력이 있습니다.'),
      priorReceipt: stored.receipt,
    };
  }
  const current = readContextSource(
    db,
    stored.replayValue.scope.projectId,
    stored.replayValue.scope.srId,
    stored.replayValue.sourceId,
  );
  if (current === undefined) return rejected(domainError('NOT_FOUND', '명령 결과 자료를 찾을 수 없습니다.'));
  return {
    kind: 'Replayed',
    value: stored.replayValue,
    receipt: stored.receipt,
    current: currentSourceBasis(current),
  };
}

function sourceError<T>(error: unknown): CommandResult<T> {
  if (error instanceof ContextSourceRepositoryError) {
    if (error.code === 'CORRUPT_DATA') return storeFailure();
    return rejected(domainError(error.code, error.message));
  }
  return storeFailure();
}

export interface SrContextService {
  registerSr(ctx: ProjectCommand, input: NewSR): CommandResult<SRView>;
  importMockTicket(ctx: ProjectCommand, key: TicketKey): CommandResult<ImportOutcome>;
  updateSrDescription(ctx: DescriptionCommand, input: SRDescriptionEdit): CommandResult<SRView>;
  attachSource(ctx: SourceAttachCommand, input: SourceInput): CommandResult<ContextSourceView>;
  confirmSource(ctx: SourceConfirmCommand, input: SourceConfirmation): CommandResult<ContextSourceView>;
  transitionStage(ctx: TransitionCommand, input: StageTransition): CommandResult<SRView>;
}

export function createSrContextService(dependencies: {
  readonly persistence: Persistence;
  readonly mockTickets: MockTicketProvider;
}): SrContextService {
  const { persistence, mockTickets } = dependencies;

  const create = (
    ctx: ProjectCommand,
    commandKind: 'M-003' | 'M-004',
    normalized: NewSR,
    inputFingerprint: string,
    mockTicket?: MockTicket,
  ): CommandResult<SRView | ImportOutcome> => {
    try {
      return persistence.withinTransaction((db) => {
        const contextError = validateProjectContext(ctx);
        if (contextError !== undefined) return rejected(contextError);
        const membership = readMembership(db, ctx.scope.projectId, ctx.actor.actorId);
        const memberError = requireProjectMember(ctx.actor.actorId, membership);
        if (memberError !== undefined) return rejected(memberError);
        const ownerMembership = readMembership(db, ctx.scope.projectId, normalized.ownerId);
        const ownerError = requireMemberOwner(normalized.ownerId, ownerMembership);
        if (ownerError !== undefined) return rejected(ownerError);
        const replay = replayOrConflict<SRView | ImportOutcome>(
          db, ctx, commandKind, inputFingerprint,
        );
        if (replay !== undefined) return replay;
        const duplicateId = findSrIdByEitherKey(db, ctx.scope.projectId, normalized.key);
        if (duplicateId !== undefined) {
          const existing = readSrView(db, ctx.scope.projectId, duplicateId);
          if (existing === undefined) return rejected(domainError('NOT_FOUND', '중복 SR을 읽을 수 없습니다.'));
          if (commandKind === 'M-003') {
            return rejected(domainError('IDEMPOTENCY_CONFLICT', '같은 SR 또는 Jira 키가 이미 있습니다.', currentBasis(existing)));
          }
          const value: ImportOutcome = { kind: 'Existing', sr: existing, ticketKey: normalized.key };
          const now = new Date().toISOString();
          const stored = receiptFor(ctx, commandKind, inputFingerprint, value, existing, now);
          storeCommandReceipt(db, { receipt: stored, replayValue: value });
          return { kind: 'Committed', value, receipt: stored };
        }
        if (!validateRequiredStrings([
          normalized.key, normalized.title, normalized.purpose,
          normalized.description, normalized.ownerId,
        ])) return rejected(domainError('VALIDATION_ERROR', 'SR 등록 필수 입력이 비었습니다.'));
        const srId = `sr-${randomUUID()}`;
        const descriptionId = `description-${randomUUID()}`;
        const now = new Date().toISOString();
        insertSrGraph(db, {
          projectId: ctx.scope.projectId,
          srId,
          key: normalized.key,
          ownerId: normalized.ownerId,
          descriptionId,
          title: normalized.title,
          purpose: normalized.purpose,
          description: normalized.description,
          authorId: ctx.actor.actorId,
          createdAt: now,
          ...(normalized.existingSystem === undefined ? {} : { existingSystem: normalized.existingSystem }),
          ...(mockTicket === undefined ? {} : { mockTicket }),
        });
        const sr = readSrView(db, ctx.scope.projectId, srId);
        if (sr === undefined) throw new Error('생성한 SR을 읽을 수 없습니다.');
        const value: SRView | ImportOutcome = commandKind === 'M-004'
          ? { kind: 'Imported', sr }
          : sr;
        const stored = receiptFor(ctx, commandKind, inputFingerprint, value, sr, now);
        storeCommandReceipt(db, { receipt: stored, replayValue: value });
        insertActivity(db, {
          projectId: ctx.scope.projectId,
          srId,
          actorId: ctx.actor.actorId,
          receiptId: stored.receiptId,
          eventType: commandKind === 'M-004' ? 'mock_ticket_imported' : 'sr_registered',
          occurredAt: now,
          description: commandKind === 'M-004' ? 'Mock Jira SR을 가져왔습니다.' : 'SR을 등록했습니다.',
        });
        return { kind: 'Committed', value, receipt: stored };
      });
    } catch {
      return storeFailure();
    }
  };

  return {
    registerSr(ctx, input) {
      const normalized = normalizeNewSr(input);
      return create(
        ctx,
        'M-003',
        normalized,
        commandFingerprint('M-003', ctx, normalized),
      ) as CommandResult<SRView>;
    },

    importMockTicket(ctx, key) {
      const normalizedKey = normalizeText(key);
      const inputFingerprint = commandFingerprint('M-004', ctx, normalizedKey);
      const contextError = validateProjectContext(ctx);
      if (contextError !== undefined) return rejected(contextError);
      try {
        const beforeProvider = persistence.readConsistent((db) => {
          const memberError = requireProjectMember(
            ctx.actor.actorId,
            readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
          );
          if (memberError !== undefined) return rejected<ImportOutcome>(memberError);
          return replayOrConflict<ImportOutcome>(db, ctx, 'M-004', inputFingerprint);
        });
        if (beforeProvider !== undefined) return beforeProvider;
      } catch {
        return storeFailure();
      }
      let ticket: MockTicket | undefined;
      try {
        ticket = mockTickets.find(normalizedKey);
      } catch {
        return rejected(domainError(
          'PROVIDER_UNAVAILABLE',
          'Mock Jira provider를 사용할 수 없습니다.',
        ));
      }
      if (ticket === undefined) return rejected(domainError('NOT_FOUND', 'Mock Jira 항목을 찾을 수 없습니다.'));
      const input: NewSR = {
        key: ticket.key,
        title: ticket.title,
        purpose: ticket.purpose,
        description: ticket.description,
        ownerId: ctx.actor.actorId,
        existingSystem: ticket.existingSystem,
      };
      return create(ctx, 'M-004', input, inputFingerprint, ticket) as CommandResult<ImportOutcome>;
    },

    updateSrDescription(ctx, input) {
      const normalized = normalizeDescription(input);
      const inputFingerprint = commandFingerprint('M-005', ctx, normalized);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateSrContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const memberError = requireProjectMember(
            ctx.actor.actorId,
            readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
          );
          if (memberError !== undefined) return rejected(memberError);
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const ownerError = requireSrOwner(ctx.actor.actorId, ownerId);
          if (ownerError !== undefined) return rejected(ownerError);
          const replay = replayOrConflict<SRView>(db, ctx, 'M-005', inputFingerprint);
          if (replay !== undefined) return replay;
          const before = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const guardError = revisionError(ctx, before);
          if (guardError !== undefined) return rejected(guardError);
          if (!validateRequiredStrings([
            normalized.title, normalized.purpose, normalized.description, normalized.changeReason,
          ])) return rejected(domainError('VALIDATION_ERROR', '설명 변경 필수 입력이 비었습니다.'));
          const now = new Date().toISOString();
          const descriptionRef = updateDescription(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            ...normalized,
            updatedAt: now,
          });
          const impact = applyDescriptionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: before.progressStage,
            changedDescriptionRef: descriptionRef,
            occurredAt: now,
          });
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId, impact.reviewImpact);
          if (sr === undefined) throw new Error('변경한 SR을 읽을 수 없습니다.');
          const stored = receiptFor(ctx, 'M-005', inputFingerprint, sr, sr, now);
          storeCommandReceipt(db, { receipt: stored, replayValue: sr });
          insertActivity(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            receiptId: stored.receiptId,
            eventType: 'sr_description_updated',
            occurredAt: now,
            description: 'SR 설명과 검토 기준을 변경했습니다.',
          });
          return { kind: 'Committed', value: sr, receipt: stored };
        });
      } catch {
        return storeFailure();
      }
    },

    attachSource(ctx, input) {
      const inputFingerprint = commandFingerprint('M-006', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateSrContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const memberError = requireProjectMember(
            ctx.actor.actorId,
            readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
          );
          if (memberError !== undefined) return rejected(memberError);
          const replay = replaySourceOrConflict(db, ctx, 'M-006', inputFingerprint);
          if (replay !== undefined) return replay;
          const before = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const guardError = revisionError(ctx, before);
          if (guardError !== undefined) return rejected(guardError);
          const now = new Date().toISOString();
          const source = insertUnconfirmedContextSource(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            sourceId: `source-${randomUUID()}`,
            createdBy: ctx.actor.actorId,
            createdAt: now,
            input,
          });
          const impact = applyContextSourceReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: before.progressStage,
            changedSourceRef: source.currentVersionRef,
            after: source,
            occurredAt: now,
          });
          const value = toContextSourceView(source, impact.reviewImpact);
          const receipt = sourceReceiptFor(ctx, 'M-006', inputFingerprint, value, now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertActivity(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            eventType: 'context_source_attached',
            occurredAt: now,
            description: '근거 자료를 미확인 상태로 등록했습니다.',
            targetRefs: [
              {
                kind: 'context_source', projectId: ctx.scope.projectId,
                srId: ctx.scope.srId, entityId: source.sourceId,
              },
              source.currentVersionRef,
            ],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return sourceError(error);
      }
    },

    confirmSource(ctx, input) {
      const inputFingerprint = commandFingerprint('M-007', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateSrContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const memberError = requireProjectMember(
            ctx.actor.actorId,
            readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
          );
          if (memberError !== undefined) return rejected(memberError);
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const ownerError = requireSrOwner(ctx.actor.actorId, ownerId);
          if (ownerError !== undefined) return rejected(ownerError);
          const replay = replaySourceOrConflict(db, ctx, 'M-007', inputFingerprint);
          if (replay !== undefined) return replay;
          const requestedRef = input.sourceVersionRef;
          if (
            requestedRef.projectId !== ctx.scope.projectId ||
            requestedRef.srId !== ctx.scope.srId
          ) return rejected(domainError('VALIDATION_ERROR', 'source version의 범위가 현재 SR과 다릅니다.'));
          const beforeSr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (beforeSr === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const before = readContextSource(
            db, ctx.scope.projectId, ctx.scope.srId, requestedRef.entityId,
          );
          if (before === undefined) return rejected(domainError('NOT_FOUND', '확인할 자료를 찾을 수 없습니다.'));
          const guardError = sourceRevisionError(ctx, requestedRef, before);
          if (guardError !== undefined) return rejected(guardError);
          if (input.confirmationEvidence.trim().length === 0) {
            return rejected(domainError('VALIDATION_ERROR', '사람 확인 근거가 비었습니다.'));
          }
          const now = new Date().toISOString();
          const confirmed = confirmContextSource(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            sourceVersionRef: requestedRef,
            expectedRevision: ctx.guard.resource.expectedRevision,
            confirmedBy: ctx.actor.actorId,
            confirmedAt: now,
            confirmationEvidence: input.confirmationEvidence,
          });
          const impact = applyContextSourceReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: beforeSr.progressStage,
            changedSourceRef: confirmed.currentVersionRef,
            before,
            after: confirmed,
            occurredAt: now,
          });
          const value = toContextSourceView(confirmed, impact.reviewImpact);
          const receipt = sourceReceiptFor(ctx, 'M-007', inputFingerprint, value, now);
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertActivity(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            eventType: 'context_source_confirmed',
            occurredAt: now,
            description: '근거 자료 version을 사람이 확인했습니다.',
            targetRefs: [
              {
                kind: 'context_source', projectId: ctx.scope.projectId,
                srId: ctx.scope.srId, entityId: confirmed.sourceId,
              },
              confirmed.currentVersionRef,
            ],
          });
          return { kind: 'Committed', value, receipt };
        });
      } catch (error) {
        return sourceError(error);
      }
    },

    transitionStage(ctx, input) {
      const normalized = { toStage: input.toStage, reason: normalizeText(input.reason) };
      const inputFingerprint = commandFingerprint('M-028', ctx, normalized);
      try {
        return persistence.withinTransaction((db) => {
          const contextError = validateSrContext(ctx);
          if (contextError !== undefined) return rejected(contextError);
          const memberError = requireProjectMember(
            ctx.actor.actorId,
            readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
          );
          if (memberError !== undefined) return rejected(memberError);
          const ownerId = readSrOwner(db, ctx.scope.projectId, ctx.scope.srId);
          if (ownerId === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const ownerError = requireSrOwner(ctx.actor.actorId, ownerId);
          if (ownerError !== undefined) return rejected(ownerError);
          const replay = replayOrConflict<SRView>(db, ctx, 'M-028', inputFingerprint);
          if (replay !== undefined) return replay;
          const before = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (before === undefined) return rejected(domainError('NOT_FOUND', 'SR을 찾을 수 없습니다.'));
          const guardError = revisionError(ctx, before);
          if (guardError !== undefined) return rejected(guardError);
          if (before.progressStage !== 'sr_received' || normalized.toStage !== 'requirements') {
            return rejected(domainError(
              'GATE_BLOCKED',
              '이번 단계에서는 접수에서 요구사항 구체화로만 전환할 수 있습니다.',
              currentBasis(before),
            ));
          }
          if (normalized.reason.length === 0) return rejected(domainError('VALIDATION_ERROR', '전환 이유가 비었습니다.'));
          const now = new Date().toISOString();
          transitionReceivedSr(db, ctx.scope.projectId, ctx.scope.srId, now);
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) throw new Error('전환한 SR을 읽을 수 없습니다.');
          const stored = receiptFor(ctx, 'M-028', inputFingerprint, sr, sr, now);
          storeCommandReceipt(db, { receipt: stored, replayValue: sr });
          insertActivity(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            receiptId: stored.receiptId,
            eventType: 'sr_stage_transitioned',
            occurredAt: now,
            description: '요구사항 구체화를 시작했습니다.',
          });
          return { kind: 'Committed', value: sr, receipt: stored };
        });
      } catch {
        return storeFailure();
      }
    },
  };
}
