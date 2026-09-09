import { createHash, randomUUID } from 'node:crypto';
import type {
  CommandContext,
  DraftApplicationGuard,
  FingerprintGuard,
  QueryContext,
  RevisionOrAbsentGuard,
  SrScope,
} from '@/src/contracts/context';
import type { CommandResult, CurrentBasis, DomainError } from '@/src/contracts/results';
import type {
  ArtifactDiffView,
  ArtifactEdit,
  ArtifactVersionPair,
  ArtifactView,
  AppliedDraftView,
  DraftApplication,
  DraftApplicationResult,
  DraftView,
  ReviewedDraftInput,
  WorkflowPlanEdit,
  WorkflowPlanView,
} from '@/src/contracts/views';
import { WorkspaceServiceError } from '@/src/application/workspace-service';
import { requireProjectMember, requireSrOwner } from '@/src/domain/authorization';
import { validateArtifactEdit } from '@/src/domain/artifact-rules';
import {
  ArtifactRepositoryError,
  insertArtifactActivity,
  readArtifactVersion,
  readCurrentArtifacts,
  storeArtifactVersion,
  toArtifactView,
} from '@/src/persistence/artifact-repository';
import { readCommandReceipt, storeCommandReceipt } from '@/src/persistence/command-receipts';
import type { DatabaseConnection } from '@/src/persistence/database';
import { applyVersionReviewImpact } from '@/src/persistence/review-impact-repository';
import { carryUnresolvedChangeRequests, ChangeRequestRepositoryError } from '@/src/persistence/change-request-repository';
import { readMembership, readSrOwner, readSrView } from '@/src/persistence/sr-repository';
import type { Persistence } from '@/src/persistence/transaction';
import {
  applyDecisionDraftSelections,
  applyQuestionDraftSelections,
  QuestionDecisionRepositoryError,
  readDecisionView,
  readQuestionView,
} from '@/src/persistence/question-decision-repository';
import {
  DraftRepositoryError,
  insertDraftApplication,
  insertReviewedDraft,
} from '@/src/persistence/draft-repository';
import {
  GenerationResultInputError,
  GenerationRunReadError,
  readStoredGenerationDraft,
  validateGenerationResultInput,
} from '@/src/persistence/generation-run-query';
import {
  GenerationPreparationError,
  normalizeReviewedGenerationInput,
  readGenerationPreparation,
} from '@/src/application/generation-preparation';
import type { ProjectRuleSnapshot } from '@/src/runtime/project-rule-source';
import {
  GenerationInputTooLargeError,
  prepareGenerationSnapshot,
} from '@/src/application/generation-snapshot';
import { readGenerationBasis } from '@/src/persistence/generation-input-repository';
import { insertInputSnapshot } from '@/src/persistence/input-snapshot-repository';

type ArtifactCommand = CommandContext<SrScope, RevisionOrAbsentGuard<'artifact'>>;
type ApplyDraftCommand = CommandContext<SrScope, DraftApplicationGuard>;
type ReviewDraftCommand = CommandContext<SrScope, FingerprintGuard>;

export class ArtifactServiceError extends WorkspaceServiceError {}

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

function reject<T>(code: DomainError['code'], message: string, current?: CurrentBasis): CommandResult<T> {
  return { kind: 'Rejected', error: domainError(code, message, current) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(
  commandKind: 'M-015' | 'M-017' | 'M-018' | 'M-019',
  ctx: ArtifactCommand | ApplyDraftCommand | ReviewDraftCommand,
  input: unknown,
): string {
  return `sha256:${createHash('sha256').update(canonical({
    schemaVersion: 1, commandKind, scope: ctx.scope, guard: ctx.guard, input,
  })).digest('hex')}`;
}

function authorizeOwner(
  db: DatabaseConnection,
  ctx: ArtifactCommand | ApplyDraftCommand | ReviewDraftCommand,
): DomainError | undefined {
  const member = requireProjectMember(
    ctx.actor.actorId,
    readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
  );
  return member ?? requireSrOwner(
    ctx.actor.actorId,
    readSrOwner(db, ctx.scope.projectId, ctx.scope.srId) ?? '',
  );
}

function assertGuardMatchesInput(ctx: ArtifactCommand, edit: ArtifactEdit | WorkflowPlanEdit): boolean {
  const expected = ctx.guard.resource;
  if (edit.targetBasis.kind === 'absent') {
    return expected.target.kind === 'artifact_logical_key' &&
      'expected' in expected && expected.expected === 'absent' &&
      expected.target.projectId === ctx.scope.projectId &&
      expected.target.srId === ctx.scope.srId &&
      expected.target.logicalKey === edit.targetBasis.logicalKey;
  }
  return 'expectedRevision' in expected && expected.target.kind === 'artifact' &&
    expected.target.projectId === ctx.scope.projectId &&
    expected.target.srId === ctx.scope.srId &&
    expected.target.entityId === edit.targetBasis.ref.entityId;
}

function currentBasis(view: ArtifactView): CurrentBasis {
  return {
    target: {
      kind: 'artifact', projectId: view.versionRef.projectId, srId: view.versionRef.srId,
      entityId: view.artifactId,
    },
    currentRevision: view.revision,
    allowedActions: [],
  };
}

function sectionContent(artifact: ArtifactView, sectionId: string): unknown {
  const section = artifact.sectionIndex.find((item) => item.sectionId === sectionId);
  if (section === undefined) return undefined;
  return {
    title: section.title,
    markdown: artifact.markdown.slice(section.startOffset, section.endOffset),
  };
}

function requirementContent(artifact: ArtifactView, requirementId: string): unknown {
  return artifact.requirementLinks.find((item) => item.requirementId === requirementId);
}

function changedDecisionRefs(before: ArtifactView, after: ArtifactView) {
  const refs = new Map<string, ArtifactView['decisionRefs'][number]>();
  for (const ref of [...before.decisionRefs, ...after.decisionRefs]) refs.set(canonical(ref), ref);
  return [...refs.entries()]
    .filter(([key]) =>
      !before.decisionRefs.some((ref) => canonical(ref) === key) ||
      !after.decisionRefs.some((ref) => canonical(ref) === key),
    )
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, ref]) => ref);
}

function changedIds(
  beforeIds: readonly string[],
  afterIds: readonly string[],
  beforeContent: (id: string) => unknown,
  afterContent: (id: string) => unknown,
): readonly string[] {
  return [...new Set([...beforeIds, ...afterIds])]
    .filter((id) => canonical(beforeContent(id)) !== canonical(afterContent(id)))
    .sort();
}

function isSqliteError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && error.code.startsWith('SQLITE_');
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function draftCurrentBasis(scope: SrScope, draftId: string, inputFingerprint: string): CurrentBasis {
  return {
    target: {
      kind: 'generation_draft', projectId: scope.projectId, srId: scope.srId, entityId: draftId,
    },
    inputFingerprint,
    allowedActions: [],
  };
}

function draftBodyMatchesApplication(
  draft: DraftView,
  input: DraftApplication,
): boolean {
  if (input.selectedContent.kind === 'artifact') {
    const edit = input.selectedContent.edit;
    return draft.body.kind === 'artifact' && draft.body.documentKind === edit.kind &&
      draft.body.markdown === edit.markdown && draft.body.changeSummary === edit.changeSummary &&
      sameJson([...draft.body.requirementRefs].sort(), [
        ...edit.requirementLinks.map(({ requirementId }) => requirementId),
      ].sort());
  }
  if (input.selectedContent.kind === 'questions') {
    if (draft.body.kind !== 'question_proposals') return false;
    const selected = input.selectedContent.temporaryIds;
    return new Set(selected).size === selected.length && selected.every((temporaryId) =>
      draft.body.kind === 'question_proposals' &&
      draft.body.proposals.some((proposal) => proposal.temporaryId === temporaryId),
    );
  }
  if (draft.body.kind !== 'decision_proposals') return false;
  const ids = input.selectedContent.selections.map(({ temporaryId }) => temporaryId);
  return new Set(ids).size === ids.length && ids.every((temporaryId) =>
    draft.body.kind === 'decision_proposals' &&
    draft.body.proposals.some((proposal) => proposal.temporaryId === temporaryId),
  );
}

function draftGuardMatches(
  db: DatabaseConnection,
  scope: SrScope,
  input: DraftApplication,
  guard: DraftApplicationGuard,
): boolean {
  if (input.selectedContent.kind !== guard.kind) return false;
  if (guard.kind !== 'artifact' || input.selectedContent.kind !== 'artifact') return true;
  const target = input.selectedContent.edit.targetBasis;
  if (target.kind === 'absent') {
    return 'expected' in guard.target && guard.target.expected === 'absent' &&
      guard.target.target.kind === 'artifact_logical_key' &&
      guard.target.target.projectId === scope.projectId && guard.target.target.srId === scope.srId &&
      guard.target.target.logicalKey === target.logicalKey;
  }
  if (
    !('expectedRevision' in guard.target) || guard.target.target.kind !== 'artifact' ||
    guard.target.target.projectId !== scope.projectId || guard.target.target.srId !== scope.srId ||
    guard.target.target.entityId !== target.ref.entityId
  ) return false;
  const current = readArtifactVersion(db, target.ref);
  return current !== undefined && current.revision === guard.target.expectedRevision;
}

function gatesForDraft(input: DraftApplication): readonly ('G1' | 'G2')[] {
  if (input.selectedContent.kind === 'artifact') {
    return input.selectedContent.edit.kind === 'requirements' ? ['G1', 'G2'] : ['G2'];
  }
  if (input.selectedContent.kind === 'questions') return [];
  const gates = input.selectedContent.selections
    .map(({ classification }) => classification.requiredGate)
    .filter((gate): gate is 'G1' | 'G2' => gate === 'G1' || gate === 'G2');
  return gates.includes('G1') ? ['G1', 'G2'] : gates.includes('G2') ? ['G2'] : [];
}

function readDraftPreparation(
  db: DatabaseConnection,
  scope: SrScope,
  draftId: string,
  projectRules: ProjectRuleSnapshot,
) {
  const preparation = readGenerationPreparation(
    db, scope, { kind: 'draft', draftId }, projectRules,
  );
  if (preparation.kind !== 'draft') throw new Error('draft preparation 종류가 바뀌었습니다.');
  return preparation;
}

export interface ArtifactService {
  saveArtifact(ctx: ArtifactCommand, edit: ArtifactEdit): CommandResult<ArtifactView>;
  saveWorkflowPlan(ctx: ArtifactCommand, edit: WorkflowPlanEdit): CommandResult<WorkflowPlanView>;
  compareArtifacts(ctx: QueryContext<SrScope>, pair: ArtifactVersionPair): ArtifactDiffView;
  applyDraft(ctx: ApplyDraftCommand, input: DraftApplication): CommandResult<AppliedDraftView>;
  createReviewedDraft(ctx: ReviewDraftCommand, input: ReviewedDraftInput): CommandResult<DraftView>;
}

export function createArtifactService(
  persistence: Persistence,
  projectRules: ProjectRuleSnapshot,
): ArtifactService {
  const save = <T extends ArtifactEdit | WorkflowPlanEdit>(
    commandKind: 'M-015' | 'M-017',
    ctx: ArtifactCommand,
    edit: T,
  ): CommandResult<T extends WorkflowPlanEdit ? WorkflowPlanView : ArtifactView> => {
    const assessment = validateArtifactEdit(ctx.scope, edit);
    if (!assessment.ok || !assertGuardMatchesInput(ctx, edit)) {
      return reject('VALIDATION_ERROR', '문서 입력, target 또는 guard가 올바르지 않습니다.');
    }
    const inputFingerprint = fingerprint(commandKind, ctx, edit);
    try {
      return persistence.withinTransaction((db) => {
        const authorization = authorizeOwner(db, ctx);
        if (authorization !== undefined) return { kind: 'Rejected', error: authorization };
        const prior = readCommandReceipt<ArtifactView | WorkflowPlanView>(db, {
          scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey,
        });
        if (prior !== undefined) {
          if (
            prior.receipt.commandKind !== commandKind ||
            prior.receipt.inputFingerprint !== inputFingerprint
          ) {
            return {
              kind: 'Rejected' as const,
              error: domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'),
              priorReceipt: prior.receipt,
            };
          }
          const replayValue = prior.replayValue;
          const current = readCurrentArtifacts(db, ctx.scope.projectId, ctx.scope.srId)
            .find((artifact) => artifact.artifactId === replayValue.artifactId);
          if (current === undefined) return reject('NOT_FOUND', '명령 결과 문서를 찾을 수 없습니다.');
          return {
            kind: 'Replayed' as const,
            value: replayValue,
            receipt: prior.receipt,
            current: currentBasis(toArtifactView(current, {
              affectedGates: [], needsNewReview: false, carriedBlockingRequestIds: [],
              currentHandoffValid: true,
            })),
          };
        }
        const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
        if (sr === undefined) return reject('NOT_FOUND', '문서를 저장할 SR을 찾을 수 없습니다.');
        if (edit.targetBasis.kind === 'version') {
          const expected = ctx.guard.resource;
          const current = readArtifactVersion(db, edit.targetBasis.ref);
          if (current === undefined) return reject('NOT_FOUND', '개정할 문서를 찾을 수 없습니다.');
          if (!('expectedRevision' in expected) || expected.expectedRevision !== current.revision) {
            return reject('STALE_VERSION', '문서 revision이 바뀌었습니다.', currentBasis(toArtifactView(current, {
              affectedGates: [], needsNewReview: false, carriedBlockingRequestIds: [],
              currentHandoffValid: true,
            })));
          }
        }
        const occurredAt = new Date().toISOString();
        const stored = storeArtifactVersion(db, {
          scope: ctx.scope, edit, authorOrigin: 'human', authorId: ctx.actor.actorId, createdAt: occurredAt,
        });
        carryUnresolvedChangeRequests(db, {
          scope: ctx.scope,
          artifactVersionRef: stored.versionRef,
          sectionIds: stored.sectionIndex.map((section) => section.sectionId),
          actorId: ctx.actor.actorId,
          occurredAt,
        });
        const affectedGates = edit.kind === 'requirements' ? ['G1', 'G2'] as const : ['G2'] as const;
        const impact = applyVersionReviewImpact(db, {
          projectId: ctx.scope.projectId,
          srId: ctx.scope.srId,
          actorId: ctx.actor.actorId,
          currentStage: sr.progressStage,
          changedVersionRef: stored.versionRef,
          affectedGates,
          reason: '문서 version이 바뀌어 승인 기준을 다시 검토합니다.',
          occurredAt,
          incrementSrRevision: true,
        });
        const value = toArtifactView(stored, impact.reviewImpact) as T extends WorkflowPlanEdit
          ? WorkflowPlanView
          : ArtifactView;
        const receipt = {
          scope: ctx.scope,
          receiptId: `receipt-${randomUUID()}`,
          actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
          commandKind,
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
          inputFingerprint,
          committedRevision: stored.revision,
          resultRefs: [stored.versionRef],
          committedAt: occurredAt,
        };
        insertArtifactActivity(db, {
          scope: ctx.scope, actorId: ctx.actor.actorId, occurredAt,
          receiptId: receipt.receiptId,
          targetRefs: [stored.versionRef],
          eventType: commandKind === 'M-017' ? 'workflow_plan_saved' : 'artifact_saved',
          description: commandKind === 'M-017' ? '진행 계획을 저장했습니다.' : '문서 버전을 저장했습니다.',
        });
        storeCommandReceipt(db, { receipt, replayValue: value });
        return { kind: 'Committed' as const, value, receipt };
      }) as CommandResult<T extends WorkflowPlanEdit ? WorkflowPlanView : ArtifactView>;
    } catch (error) {
      if (error instanceof ArtifactRepositoryError) {
        if (error.code === 'VALIDATION_ERROR') return reject('VALIDATION_ERROR', error.message);
        if (error.code === 'NOT_FOUND') return reject('NOT_FOUND', error.message);
        if (error.code === 'STALE_VERSION') return reject('STALE_VERSION', error.message);
        return reject('STORE_UNAVAILABLE', '저장된 문서 자료를 안전하게 읽을 수 없습니다.');
      }
      if (error instanceof ChangeRequestRepositoryError) return reject('STORE_UNAVAILABLE', '저장된 수정 요청을 안전하게 승계할 수 없습니다.');
      if (isSqliteError(error)) return reject('STORE_UNAVAILABLE', '문서 저장을 확정하지 못했습니다.');
      throw error;
    }
  };

  return {
    saveArtifact(ctx, edit) {
      return save('M-015', ctx, edit);
    },
    saveWorkflowPlan(ctx, edit) {
      return save('M-017', ctx, edit);
    },
    applyDraft(ctx, input) {
      const inputFingerprint = fingerprint('M-018', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const authorization = authorizeOwner(db, ctx);
          if (authorization !== undefined) return { kind: 'Rejected', error: authorization };
          const prior = readCommandReceipt<AppliedDraftView>(db, {
            scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey,
          });
          if (prior !== undefined) {
            if (
              prior.receipt.commandKind !== 'M-018' ||
              prior.receipt.inputFingerprint !== inputFingerprint
            ) {
              return {
                kind: 'Rejected' as const,
                error: domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'),
                priorReceipt: prior.receipt,
              };
            }
            const preparation = readDraftPreparation(db, ctx.scope, input.draftId, projectRules);
            return {
              kind: 'Replayed' as const,
              value: prior.replayValue,
              receipt: prior.receipt,
              current: draftCurrentBasis(ctx.scope, input.draftId, preparation.currentInputFingerprint),
            };
          }
          if (input.selectedContent.kind !== ctx.guard.kind) {
            return reject('VALIDATION_ERROR', '초안 종류와 guard가 일치하지 않습니다.');
          }
          if (!draftGuardMatches(db, ctx.scope, input, ctx.guard)) {
            return reject('STALE_VERSION', '초안 문서 target의 현재 revision과 guard가 다릅니다.');
          }
          const preparation = readDraftPreparation(db, ctx.scope, input.draftId, projectRules);
          if (preparation.draftBasisFingerprint !== preparation.currentInputFingerprint) {
            return reject(
              'INPUT_CHANGED',
              '원 초안의 생성 입력이 현재 기준과 다릅니다. 먼저 현재 기준으로 검토 초안을 만드세요.',
              draftCurrentBasis(ctx.scope, input.draftId, preparation.currentInputFingerprint),
            );
          }
          if (ctx.guard.expectedInputFingerprint !== preparation.currentInputFingerprint) {
            return reject(
              'INPUT_CHANGED',
              '현재 생성 입력이 검토한 기준과 다릅니다.',
              draftCurrentBasis(ctx.scope, input.draftId, preparation.currentInputFingerprint),
            );
          }
          const storedDraft = readStoredGenerationDraft(
            db,
            ctx.scope.projectId,
            ctx.scope.srId,
            input.draftId,
            preparation.currentInputFingerprint,
          );
          if (storedDraft === undefined) return reject('NOT_FOUND', '적용할 초안을 찾을 수 없습니다.');
          if (!draftBodyMatchesApplication(storedDraft.view, input)) {
            return reject('VALIDATION_ERROR', '선택 내용이 저장된 초안과 일치하지 않습니다.');
          }
          if (
            input.selectedContent.kind === 'artifact' &&
            (!sameJson(input.selectedContent.edit.targetBasis, preparation.draftTargetBasis) ||
              !sameJson(input.selectedContent.edit.targetBasis, preparation.currentTargetBasis))
          ) {
            return reject('INPUT_CHANGED', '초안의 문서 target이 현재 기준과 다릅니다.');
          }
          const sr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (sr === undefined) return reject('NOT_FOUND', '초안의 SR을 찾을 수 없습니다.');
          const occurredAt = new Date().toISOString();
          const receiptId = `receipt-${randomUUID()}`;
          const applicationId = `application-${randomUUID()}`;
          let result: DraftApplicationResult;
          let changedVersionRef;
          let affectedGates: readonly ('G1' | 'G2')[] = gatesForDraft(input);
          if (input.selectedContent.kind === 'artifact') {
            const edit = input.selectedContent.edit;
            const assessment = validateArtifactEdit(ctx.scope, edit);
            if (!assessment.ok) return reject('VALIDATION_ERROR', '적용 문서 구조가 올바르지 않습니다.');
            const stored = storeArtifactVersion(db, {
              scope: ctx.scope,
              edit,
              authorOrigin: 'ai_applied',
              authorId: ctx.actor.actorId,
              createdAt: occurredAt,
              draftApplicationId: applicationId,
              inputSnapshotId: storedDraft.inputSnapshotId,
            });
            carryUnresolvedChangeRequests(db, {
              scope: ctx.scope,
              artifactVersionRef: stored.versionRef,
              sectionIds: stored.sectionIndex.map((section) => section.sectionId),
              actorId: ctx.actor.actorId,
              occurredAt,
            });
            result = { kind: 'artifact', artifactVersionRef: stored.versionRef };
            changedVersionRef = stored.versionRef;
          } else if (input.selectedContent.kind === 'questions') {
            if (storedDraft.view.body.kind !== 'question_proposals') {
              return reject('VALIDATION_ERROR', '질문 초안이 아닙니다.');
            }
            const selected = new Set(input.selectedContent.temporaryIds);
            const proposals = storedDraft.view.body.proposals.filter(({ temporaryId }) => selected.has(temporaryId));
            const mappings = applyQuestionDraftSelections(db, {
              scope: ctx.scope,
              actorId: ctx.actor.actorId,
              occurredAt,
              draftId: input.draftId,
              proposals,
            });
            const first = mappings[0];
            if (first === undefined) return reject('VALIDATION_ERROR', '선택한 질문이 없습니다.');
            result = { kind: 'questions', mappings: [first, ...mappings.slice(1)] };
            const question = readQuestionView(db, ctx.scope, first.ref.entityId);
            if (question === undefined) throw new Error('저장한 질문을 읽을 수 없습니다.');
            changedVersionRef = question.currentResult.ref;
            const gates = proposals.map(({ requiredGate }) => requiredGate);
            affectedGates = gates.includes('G1') ? ['G1', 'G2'] : ['G2'];
          } else {
            if (storedDraft.view.body.kind !== 'decision_proposals') {
              return reject('VALIDATION_ERROR', '결정 초안이 아닙니다.');
            }
            const proposals = new Map(
              storedDraft.view.body.proposals.map((proposal) => [proposal.temporaryId, proposal]),
            );
            const selections = input.selectedContent.selections.map((selection) => {
              const proposal = proposals.get(selection.temporaryId);
              if (proposal === undefined) throw new QuestionDecisionRepositoryError(
                'INVALID_INPUT', '선택한 decision proposal을 찾을 수 없습니다.',
              );
              return { proposal, decisionMakerId: selection.decisionMakerId, classification: selection.classification };
            });
            const mappings = applyDecisionDraftSelections(db, {
              scope: ctx.scope,
              actorId: ctx.actor.actorId,
              occurredAt,
              draftId: input.draftId,
              selections,
            });
            const first = mappings[0];
            if (first === undefined) return reject('VALIDATION_ERROR', '선택한 decision이 없습니다.');
            result = { kind: 'decisions', mappings: [first, ...mappings.slice(1)] };
            const decision = readDecisionView(db, ctx.scope, first.ref.entityId);
            if (decision === undefined) throw new Error('저장한 decision을 읽을 수 없습니다.');
            changedVersionRef = decision.classificationRef;
          }
          const impact = applyVersionReviewImpact(db, {
            projectId: ctx.scope.projectId,
            srId: ctx.scope.srId,
            actorId: ctx.actor.actorId,
            currentStage: sr.progressStage,
            changedVersionRef,
            affectedGates,
            reason: '검토한 생성 초안을 적용해 현재 업무 기준을 갱신합니다.',
            occurredAt,
            incrementSrRevision: true,
          });
          insertDraftApplication(db, {
            scope: ctx.scope,
            draftId: input.draftId,
            appliedBy: ctx.actor.actorId,
            appliedAt: occurredAt,
            checkedInputFingerprint: preparation.currentInputFingerprint,
            selectedContent: input.selectedContent,
            result,
            receiptId,
            applicationId,
            ...(input.applicationReason === undefined ? {} : { reason: input.applicationReason }),
          });
          const value: AppliedDraftView = {
            applicationId,
            draftId: input.draftId,
            result,
            reviewImpact: impact.reviewImpact,
          };
          const currentSr = readSrView(db, ctx.scope.projectId, ctx.scope.srId);
          if (currentSr === undefined) throw new Error('적용 뒤 SR을 읽을 수 없습니다.');
          const resultRefs = result.kind === 'artifact'
            ? [result.artifactVersionRef]
            : result.mappings.map(({ ref }) => ref);
          const receipt = {
            scope: ctx.scope,
            receiptId,
            actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
            commandKind: 'M-018',
            requestId: ctx.requestId,
            idempotencyKey: ctx.idempotencyKey,
            inputFingerprint,
            committedRevision: currentSr.revision,
            resultRefs: [{
              kind: 'draft_application' as const,
              projectId: ctx.scope.projectId,
              srId: ctx.scope.srId,
              entityId: applicationId,
            }, ...resultRefs],
            committedAt: occurredAt,
          };
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertArtifactActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId,
            occurredAt,
            eventType: 'generation_draft_applied',
            description: '검토한 생성 초안을 적용했습니다.',
            targetRefs: receipt.resultRefs,
          });
          return { kind: 'Committed' as const, value, receipt };
        });
      } catch (error) {
        if (error instanceof ArtifactRepositoryError) {
          if (error.code === 'VALIDATION_ERROR') return reject('VALIDATION_ERROR', error.message);
          if (error.code === 'NOT_FOUND') return reject('NOT_FOUND', error.message);
          if (error.code === 'STALE_VERSION') return reject('STALE_VERSION', error.message);
          return reject('STORE_UNAVAILABLE', '저장된 문서 자료를 안전하게 읽을 수 없습니다.');
        }
        if (error instanceof DraftRepositoryError) {
          return reject(error.code === 'ALREADY_APPLIED' ? 'INPUT_CHANGED' : 'STORE_UNAVAILABLE', error.message);
        }
        if (error instanceof QuestionDecisionRepositoryError) {
          return reject(error.code === 'INVALID_INPUT' ? 'VALIDATION_ERROR' : 'STORE_UNAVAILABLE', error.message);
        }
        if (
          error instanceof GenerationRunReadError ||
          (error instanceof GenerationPreparationError && error.code === 'CORRUPT_DATA')
        ) return reject('STORE_UNAVAILABLE', '저장된 초안 자료를 안전하게 읽을 수 없습니다.');
        if (error instanceof GenerationPreparationError) {
          return reject(error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR', error.message);
        }
        if (error instanceof GenerationInputTooLargeError) {
          return reject('VALIDATION_ERROR', error.message);
        }
        if (isSqliteError(error)) return reject('STORE_UNAVAILABLE', '초안 적용을 확정하지 못했습니다.');
        throw error;
      }
    },
    createReviewedDraft(ctx, input) {
      const inputFingerprint = fingerprint('M-019', ctx, input);
      try {
        return persistence.withinTransaction((db) => {
          const authorization = authorizeOwner(db, ctx);
          if (authorization !== undefined) return { kind: 'Rejected', error: authorization };
          const prior = readCommandReceipt<DraftView>(db, {
            scope: ctx.scope, actorId: ctx.actor.actorId, idempotencyKey: ctx.idempotencyKey,
          });
          if (prior !== undefined) {
            if (
              prior.receipt.commandKind !== 'M-019' ||
              prior.receipt.inputFingerprint !== inputFingerprint
            ) {
              return {
                kind: 'Rejected' as const,
                error: domainError('IDEMPOTENCY_CONFLICT', '같은 idempotency key의 명령이 다릅니다.'),
                priorReceipt: prior.receipt,
              };
            }
            const preparation = readDraftPreparation(
              db, ctx.scope, prior.replayValue.draftId, projectRules,
            );
            return {
              kind: 'Replayed' as const,
              value: prior.replayValue,
              receipt: prior.receipt,
              current: draftCurrentBasis(
                ctx.scope, prior.replayValue.draftId, preparation.currentInputFingerprint,
              ),
            };
          }
          if (ctx.guard.expectedInputFingerprint !== input.currentInputFingerprint) {
            return reject('VALIDATION_ERROR', '검토 입력과 guard fingerprint가 다릅니다.');
          }
          const preparation = readDraftPreparation(db, ctx.scope, input.sourceDraftId, projectRules);
          if (preparation.currentInputFingerprint !== input.currentInputFingerprint) {
            return reject(
              'INPUT_CHANGED',
              '현재 생성 입력이 검토한 기준과 다릅니다.',
              draftCurrentBasis(ctx.scope, input.sourceDraftId, preparation.currentInputFingerprint),
            );
          }
          const source = readStoredGenerationDraft(
            db,
            ctx.scope.projectId,
            ctx.scope.srId,
            input.sourceDraftId,
            preparation.currentInputFingerprint,
          );
          if (source === undefined) return reject('NOT_FOUND', '검토할 초안을 찾을 수 없습니다.');
          const compatible =
            (source.view.taskKind === 'QUESTION_PROPOSALS' && input.body.kind === 'question_proposals') ||
            (source.view.taskKind === 'DECISION_PROPOSALS' && input.body.kind === 'decision_proposals') ||
            ((source.view.taskKind === 'ARTIFACT_DRAFT' || source.view.taskKind === 'ARTIFACT_REVISION') &&
              input.body.kind === 'artifact' && source.view.body.kind === 'artifact' &&
              input.body.documentKind === source.view.body.documentKind);
          if (!compatible) return reject('VALIDATION_ERROR', '검토 본문 종류가 원 초안 작업과 다릅니다.');
          const occurredAt = new Date().toISOString();
          const currentBasis = readGenerationBasis(db, ctx.scope);
          if (currentBasis === undefined) return reject('NOT_FOUND', '검토할 초안의 SR을 찾을 수 없습니다.');
          const normalizedInput = normalizeReviewedGenerationInput(preparation.input, currentBasis);
          const currentPrepared = prepareGenerationSnapshot(
            normalizedInput, currentBasis, projectRules,
          );
          validateGenerationResultInput(
            input.body,
            ctx.scope.projectId,
            ctx.scope.srId,
            currentPrepared.basisRefs,
          );
          const currentSnapshot = insertInputSnapshot(db, {
            basis: currentBasis,
            prepared: currentPrepared,
            projectRules,
            capturedAt: occurredAt,
          });
          const value = insertReviewedDraft(db, {
            scope: ctx.scope,
            sourceDraftId: input.sourceDraftId,
            taskKind: normalizedInput.taskKind,
            body: input.body,
            inputSnapshotId: currentSnapshot.snapshotId,
            basisFingerprint: currentSnapshot.contentFingerprint,
            reviewedBy: ctx.actor.actorId,
            reviewedAt: occurredAt,
            comparisonSummary: input.comparisonSummary,
          });
          const receipt = {
            scope: ctx.scope,
            receiptId: `receipt-${randomUUID()}`,
            actorRef: { actorId: ctx.actor.actorId, projectId: ctx.scope.projectId },
            commandKind: 'M-019',
            requestId: ctx.requestId,
            idempotencyKey: ctx.idempotencyKey,
            inputFingerprint,
            committedRevision: 0,
            resultRefs: [{
              kind: 'generation_draft' as const,
              projectId: ctx.scope.projectId,
              srId: ctx.scope.srId,
              entityId: value.draftId,
            }],
            committedAt: occurredAt,
          };
          storeCommandReceipt(db, { receipt, replayValue: value });
          insertArtifactActivity(db, {
            scope: ctx.scope,
            actorId: ctx.actor.actorId,
            receiptId: receipt.receiptId,
            occurredAt,
            eventType: 'generation_draft_reviewed',
            description: '생성 초안을 현재 입력 기준으로 검토했습니다.',
            targetRefs: receipt.resultRefs,
          });
          return { kind: 'Committed' as const, value, receipt };
        });
      } catch (error) {
        if (error instanceof GenerationResultInputError) {
          return reject('VALIDATION_ERROR', error.message);
        }
        if (
          error instanceof GenerationRunReadError || error instanceof DraftRepositoryError ||
          (error instanceof GenerationPreparationError && error.code === 'CORRUPT_DATA')
        ) return reject('STORE_UNAVAILABLE', '저장된 초안 자료를 안전하게 읽을 수 없습니다.');
        if (error instanceof GenerationPreparationError) {
          return reject(error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR', error.message);
        }
        if (error instanceof GenerationInputTooLargeError) {
          return reject('VALIDATION_ERROR', error.message);
        }
        if (isSqliteError(error)) return reject('STORE_UNAVAILABLE', '검토 초안을 확정하지 못했습니다.');
        throw error;
      }
    },
    compareArtifacts(ctx, pair) {
      try {
        return persistence.readConsistent((db) => {
          const authorization = requireProjectMember(
            ctx.actor.actorId,
            readMembership(db, ctx.scope.projectId, ctx.actor.actorId),
          );
          if (authorization !== undefined) throw new ArtifactServiceError(authorization);
          if (
            pair.before.projectId !== ctx.scope.projectId || pair.before.srId !== ctx.scope.srId ||
            pair.after.projectId !== ctx.scope.projectId || pair.after.srId !== ctx.scope.srId
          ) throw new ArtifactServiceError(domainError('VALIDATION_ERROR', '비교 문서 범위가 다릅니다.'));
          const before = readArtifactVersion(db, pair.before);
          const after = readArtifactVersion(db, pair.after);
          if (before === undefined || after === undefined) {
            throw new ArtifactServiceError(domainError('NOT_FOUND', '비교할 문서 version을 찾을 수 없습니다.'));
          }
          const beforeView = toArtifactView(before, {
            affectedGates: [], needsNewReview: false, carriedBlockingRequestIds: [], currentHandoffValid: true,
          });
          const afterView = toArtifactView(after, {
            affectedGates: [], needsNewReview: false, carriedBlockingRequestIds: [], currentHandoffValid: true,
          });
          return {
            before: beforeView,
            after: afterView,
            changedRequirementIds: changedIds(
              before.requirementLinks.map((item) => item.requirementId),
              after.requirementLinks.map((item) => item.requirementId),
              (id) => requirementContent(beforeView, id),
              (id) => requirementContent(afterView, id),
            ),
            changedDecisionRefs: changedDecisionRefs(beforeView, afterView),
            changedSectionIds: changedIds(
              before.sectionIndex.map((item) => item.sectionId),
              after.sectionIndex.map((item) => item.sectionId),
              (id) => sectionContent(beforeView, id),
              (id) => sectionContent(afterView, id),
            ),
          };
        });
      } catch (error) {
        if (error instanceof ArtifactServiceError) throw error;
        if (error instanceof ArtifactRepositoryError && error.code === 'CORRUPT_DATA') {
          throw new ArtifactServiceError(domainError(
            'STORE_UNAVAILABLE', '저장된 문서 자료를 안전하게 읽을 수 없습니다.',
          ));
        }
        if (isSqliteError(error)) {
          throw new ArtifactServiceError(domainError('STORE_UNAVAILABLE', '문서 비교 자료를 읽을 수 없습니다.'));
        }
        throw error;
      }
    },
  };
}
