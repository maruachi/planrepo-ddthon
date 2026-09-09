import type {
  BundleGuard,
  CommandContext,
  DraftApplicationGuard,
  FingerprintGuard,
  NoGuard,
  PolicyApplicationGuard,
  ProjectScope,
  QueryContext,
  RevisionAndBundleGuard,
  RevisionGuard,
  SrScope,
} from '@/src/contracts/context';
import type { PublicMethodRequest } from '@/src/contracts/methods';
import type { PublicMethodHandler } from '@/src/application/http/server';
import { createWorkspaceService, WorkspaceServiceError } from '@/src/application/workspace-service';
import { createSrContextService } from '@/src/application/sr-context-service';
import { createWorkspaceQueryService } from '@/src/application/workspace-query-service';
import { createArtifactService } from '@/src/application/artifact-service';
import { createQuestionDecisionService } from '@/src/application/question-decision-service';
import {
  createGenerationService,
  type CancellationNotificationPort,
} from '@/src/application/generation-service';
import type { Persistence } from '@/src/persistence/transaction';
import type { MockTicketProvider } from '@/src/providers/reference/mock-ticket-provider';
import {
  createCurrentInputFingerprintPort,
} from '@/src/application/generation-preparation';
import type { ProjectRuleSnapshot } from '@/src/runtime/project-rule-source';
import type { ProviderSelection } from '@/src/contracts/views';
import { createReviewPolicyService } from '@/src/application/review-policy-service';
import { createReviewWorkflowService } from '@/src/application/review-workflow-service';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedRequest<M extends
  | 'M-001' | 'M-002' | 'M-003' | 'M-004' | 'M-005' | 'M-006' | 'M-007'
  | 'M-008' | 'M-009' | 'M-010' | 'M-011' | 'M-012' | 'M-013' | 'M-014'
  | 'M-015' | 'M-016' | 'M-017' | 'M-018' | 'M-019'
  | 'M-020' | 'M-021' | 'M-022' | 'M-023' | 'M-024' | 'M-025' | 'M-026' | 'M-027'
  | 'M-029' | 'M-030' | 'M-031'
  | 'M-032' | 'M-033' | 'M-034' | 'M-035'
  | 'M-028' | 'M-045' | 'M-047'>(
  value: unknown,
): PublicMethodRequest<M> {
  if (!isObject(value) || !isObject(value.scope) || !('input' in value)) {
    throw new WorkspaceServiceError({
      code: 'VALIDATION_ERROR',
      message: '요청 형식이 올바르지 않습니다.',
      blockers: [],
      assigneeIds: [],
      targetRefs: [],
    });
  }
  return value as PublicMethodRequest<M>;
}

function requireActor(actorId: string | undefined, projectId: string) {
  if (actorId === undefined || actorId.length === 0) {
    throw new WorkspaceServiceError({
      code: 'FORBIDDEN',
      message: '현재 가상 사용자를 선택해야 합니다.',
      blockers: [],
      assigneeIds: [],
      targetRefs: [],
    });
  }
  return {
    actorId,
    projectId,
    roles: [],
    srAssignments: [],
    demo: true as const,
  };
}

function projectCommand(
  request: PublicMethodRequest<'M-003'> | PublicMethodRequest<'M-004'> | PublicMethodRequest<'M-029'>,
  actorId: string | undefined,
): CommandContext<ProjectScope, NoGuard> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: { kind: 'none' },
  };
}

function assignmentCommand(
  request: PublicMethodRequest<'M-030'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'review_gate_state'>> {
  return { actor: requireActor(actorId, request.scope.projectId), scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: request.meta.guard };
}

function reviewRequestCommand(
  request: PublicMethodRequest<'M-020'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'review_gate_state'>> {
  return { actor: requireActor(actorId, request.scope.projectId), scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: request.meta.guard };
}

function approvalCommand(
  request: PublicMethodRequest<'M-021'>,
  actorId: string | undefined,
): CommandContext<SrScope, BundleGuard> {
  return { actor: requireActor(actorId, request.scope.projectId), scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: request.meta.guard };
}

function commentCommand(
  request: PublicMethodRequest<'M-022'>,
  actorId: string | undefined,
): CommandContext<SrScope, NoGuard> {
  return { actor: requireActor(actorId, request.scope.projectId), scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: { kind: 'none' } };
}

function changeRequestCommand(
  request: PublicMethodRequest<'M-023'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionAndBundleGuard<'review_gate_state'>> {
  return { actor: requireActor(actorId, request.scope.projectId), scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: request.meta.guard };
}

function changeCommand<M extends 'M-024' | 'M-025' | 'M-026'>(
  request: PublicMethodRequest<M>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'change_request'>> {
  return { actor: requireActor(actorId, request.scope.projectId), scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: request.meta.guard };
}

function gatedTransitionCommand(
  request: PublicMethodRequest<'M-028'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionAndBundleGuard<'sr'>> {
  const actor = requireActor(actorId, request.scope.projectId);
  if (!('expectedBundleRef' in request.meta.guard)) {
    throw new WorkspaceServiceError({ code: 'GATE_BLOCKED', message: '게이트 단계 전환에는 현재 묶음 기준이 필요합니다.',
      blockers: [], assigneeIds: [], targetRefs: [] });
  }
  return { actor, scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: request.meta.guard };
}

function policyApplicationCommand(
  request: PublicMethodRequest<'M-031'>,
  actorId: string | undefined,
): CommandContext<SrScope, PolicyApplicationGuard> {
  return { actor: requireActor(actorId, request.scope.projectId), scope: request.scope,
    requestId: request.meta.requestId, idempotencyKey: request.meta.idempotencyKey, guard: request.meta.guard };
}

function srCommand<M extends 'M-005' | 'M-028'>(
  request: PublicMethodRequest<M>,
  actorId: string | undefined,
): CommandContext<
  SrScope,
  M extends 'M-005' ? RevisionGuard<'sr'> : RevisionGuard<'sr'> | RevisionAndBundleGuard<'sr'>
> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function sourceAttachCommand(
  request: PublicMethodRequest<'M-006'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'sr'>> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function sourceConfirmCommand(
  request: PublicMethodRequest<'M-007'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'context_source'>> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function artifactCommand<M extends 'M-015' | 'M-017'>(
  request: PublicMethodRequest<M>,
  actorId: string | undefined,
): CommandContext<SrScope, import('@/src/contracts/context').RevisionOrAbsentGuard<'artifact'>> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function questionCommand(
  request: PublicMethodRequest<'M-008'> | PublicMethodRequest<'M-009'> |
    PublicMethodRequest<'M-010'> | PublicMethodRequest<'M-011'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'question'>> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function decisionCommand(
  request: PublicMethodRequest<'M-012'> | PublicMethodRequest<'M-013'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'decision'>> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function classificationCommand(
  request: PublicMethodRequest<'M-014'>,
  actorId: string | undefined,
): CommandContext<SrScope, RevisionGuard<'question' | 'decision'>> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function applyDraftCommand(
  request: PublicMethodRequest<'M-018'>,
  actorId: string | undefined,
): CommandContext<SrScope, DraftApplicationGuard> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function reviewDraftCommand(
  request: PublicMethodRequest<'M-019'>,
  actorId: string | undefined,
): CommandContext<SrScope, FingerprintGuard> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function generationCommand<M extends 'M-032' | 'M-035'>(
  request: PublicMethodRequest<M>,
  actorId: string | undefined,
): CommandContext<SrScope, FingerprintGuard> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: request.meta.guard,
  };
}

function cancelGenerationCommand(
  request: PublicMethodRequest<'M-034'>,
  actorId: string | undefined,
): CommandContext<SrScope, NoGuard> {
  return {
    actor: requireActor(actorId, request.scope.projectId),
    scope: request.scope,
    requestId: request.meta.requestId,
    idempotencyKey: request.meta.idempotencyKey,
    guard: { kind: 'none' },
  };
}

function queryContext<S extends ProjectScope | SrScope>(
  scope: S,
  actorId: string | undefined,
): QueryContext<S> {
  return { actor: requireActor(actorId, scope.projectId), scope };
}

export interface ApplicationComposition {
  readonly handlers: Partial<Readonly<Record<
    'M-001' | 'M-002' | 'M-003' | 'M-004' | 'M-005' | 'M-006' | 'M-007'
    | 'M-008' | 'M-009' | 'M-010' | 'M-011' | 'M-012' | 'M-013' | 'M-014'
    | 'M-015' | 'M-016' | 'M-017' | 'M-018' | 'M-019'
    | 'M-020' | 'M-021' | 'M-022' | 'M-023' | 'M-024' | 'M-025' | 'M-026' | 'M-027'
    | 'M-029' | 'M-030' | 'M-031'
    | 'M-032' | 'M-033' | 'M-034' | 'M-035'
    | 'M-028' | 'M-045' | 'M-047',
    PublicMethodHandler
  >>>;
}

export function createApplicationComposition(dependencies: {
  readonly persistence: Persistence;
  readonly mockTickets: MockTicketProvider;
  readonly projectRules: ProjectRuleSnapshot;
  readonly documentReviewMode?: boolean;
  readonly generation: {
    readonly selection: ProviderSelection;
    readonly maxNonterminal: number;
    readonly providerInputBytes: number;
    readonly cancellationNotifications?: CancellationNotificationPort;
  };
}): ApplicationComposition {
  const workspace = createWorkspaceService(dependencies.persistence);
  const srContext = createSrContextService(dependencies);
  const fingerprints = createCurrentInputFingerprintPort(dependencies.projectRules);
  const queries = createWorkspaceQueryService(dependencies.persistence, {
    currentInputFingerprints: fingerprints,
    projectRules: dependencies.projectRules,
    ...(dependencies.documentReviewMode === undefined
      ? {}
      : { documentReviewMode: dependencies.documentReviewMode }),
  });
  const artifacts = createArtifactService(dependencies.persistence, dependencies.projectRules);
  const questions = createQuestionDecisionService(dependencies.persistence);
  const reviewPolicies = createReviewPolicyService(dependencies.persistence, {
    ...(dependencies.documentReviewMode === undefined
      ? {}
      : { documentReviewMode: dependencies.documentReviewMode }),
  });
  const reviews = createReviewWorkflowService(dependencies.persistence, {
    ...(dependencies.documentReviewMode === undefined
      ? {}
      : { documentReviewMode: dependencies.documentReviewMode }),
  });
  const generation = createGenerationService({
    persistence: dependencies.persistence,
    projectRules: dependencies.projectRules,
    selection: dependencies.generation.selection,
    maxNonterminal: dependencies.generation.maxNonterminal,
    providerInputBytes: dependencies.generation.providerInputBytes,
    currentInputFingerprints: fingerprints,
    ...(dependencies.generation.cancellationNotifications === undefined
      ? {}
      : { cancellationNotifications: dependencies.generation.cancellationNotifications }),
  });
  return {
    handlers: {
      'M-001': (request, actorId) => {
        const body = validatedRequest<'M-001'>(request);
        return workspace.describeWorkspace(actorId, body.scope);
      },
      'M-002': (request) => {
        const body = validatedRequest<'M-002'>(request);
        return workspace.selectDemoActor(body.scope, body.input);
      },
      'M-003': (request, actorId) => {
        const body = validatedRequest<'M-003'>(request);
        return srContext.registerSr(projectCommand(body, actorId), body.input);
      },
      'M-004': (request, actorId) => {
        const body = validatedRequest<'M-004'>(request);
        return srContext.importMockTicket(projectCommand(body, actorId), body.input);
      },
      'M-005': (request, actorId) => {
        const body = validatedRequest<'M-005'>(request);
        return srContext.updateSrDescription(srCommand(body, actorId), body.input);
      },
      'M-006': (request, actorId) => {
        const body = validatedRequest<'M-006'>(request);
        return srContext.attachSource(sourceAttachCommand(body, actorId), body.input);
      },
      'M-007': (request, actorId) => {
        const body = validatedRequest<'M-007'>(request);
        return srContext.confirmSource(sourceConfirmCommand(body, actorId), body.input);
      },
      'M-008': (request, actorId) => {
        const body = validatedRequest<'M-008'>(request);
        return questions.answerQuestion(questionCommand(body, actorId), body.input);
      },
      'M-009': (request, actorId) => {
        const body = validatedRequest<'M-009'>(request);
        return questions.resolveQuestion(questionCommand(body, actorId), body.input);
      },
      'M-010': (request, actorId) => {
        const body = validatedRequest<'M-010'>(request);
        return questions.addFollowupQuestion(questionCommand(body, actorId), body.input);
      },
      'M-011': (request, actorId) => {
        const body = validatedRequest<'M-011'>(request);
        return questions.convertQuestionToDecision(questionCommand(body, actorId), body.input);
      },
      'M-012': (request, actorId) => {
        const body = validatedRequest<'M-012'>(request);
        return questions.confirmDecision(decisionCommand(body, actorId), body.input);
      },
      'M-013': (request, actorId) => {
        const body = validatedRequest<'M-013'>(request);
        return questions.redecide(decisionCommand(body, actorId), body.input);
      },
      'M-014': (request, actorId) => {
        const body = validatedRequest<'M-014'>(request);
        return questions.classifyScope(classificationCommand(body, actorId), body.input);
      },
      'M-015': (request, actorId) => {
        const body = validatedRequest<'M-015'>(request);
        return artifacts.saveArtifact(artifactCommand(body, actorId), body.input);
      },
      'M-016': (request, actorId) => {
        const body = validatedRequest<'M-016'>(request);
        return artifacts.compareArtifacts(queryContext(body.scope, actorId), body.input);
      },
      'M-017': (request, actorId) => {
        const body = validatedRequest<'M-017'>(request);
        return artifacts.saveWorkflowPlan(artifactCommand(body, actorId), body.input);
      },
      'M-018': (request, actorId) => {
        const body = validatedRequest<'M-018'>(request);
        return artifacts.applyDraft(applyDraftCommand(body, actorId), body.input);
      },
      'M-019': (request, actorId) => {
        const body = validatedRequest<'M-019'>(request);
        return artifacts.createReviewedDraft(reviewDraftCommand(body, actorId), body.input);
      },
      'M-020': (request, actorId) => {
        const body = validatedRequest<'M-020'>(request);
        return reviews.requestReview(reviewRequestCommand(body, actorId), body.input);
      },
      'M-021': (request, actorId) => {
        const body = validatedRequest<'M-021'>(request);
        return reviews.recordApproval(approvalCommand(body, actorId), body.input);
      },
      'M-022': (request, actorId) => {
        const body = validatedRequest<'M-022'>(request);
        return reviews.addComment(commentCommand(body, actorId), body.input);
      },
      'M-023': (request, actorId) => {
        const body = validatedRequest<'M-023'>(request);
        return reviews.requestChange(changeRequestCommand(body, actorId), body.input);
      },
      'M-024': (request, actorId) => {
        const body = validatedRequest<'M-024'>(request);
        return reviews.submitChangeResult(changeCommand(body, actorId), body.input);
      },
      'M-025': (request, actorId) => {
        const body = validatedRequest<'M-025'>(request);
        return reviews.confirmChangeResolution(changeCommand(body, actorId), body.input);
      },
      'M-026': (request, actorId) => {
        const body = validatedRequest<'M-026'>(request);
        return reviews.requestFurtherChange(changeCommand(body, actorId), body.input);
      },
      'M-029': (request, actorId) => {
        const body = validatedRequest<'M-029'>(request);
        return reviewPolicies.createPolicyVersion(projectCommand(body, actorId), body.input);
      },
      'M-030': (request, actorId) => {
        const body = validatedRequest<'M-030'>(request);
        return reviewPolicies.assignReviewers(assignmentCommand(body, actorId), body.input);
      },
      'M-031': (request, actorId) => {
        const body = validatedRequest<'M-031'>(request);
        return reviewPolicies.applyPolicyToSr(policyApplicationCommand(body, actorId), body.input);
      },
      'M-032': (request, actorId) => {
        const body = validatedRequest<'M-032'>(request);
        return generation.requestGeneration(generationCommand(body, actorId), body.input);
      },
      'M-033': (request, actorId) => {
        const body = validatedRequest<'M-033'>(request);
        return generation.getGeneration(queryContext(body.scope, actorId), body.input);
      },
      'M-034': (request, actorId) => {
        const body = validatedRequest<'M-034'>(request);
        return generation.cancelGeneration(cancelGenerationCommand(body, actorId), body.input);
      },
      'M-035': (request, actorId) => {
        const body = validatedRequest<'M-035'>(request);
        return generation.retryGeneration(generationCommand(body, actorId), body.input);
      },
      'M-028': (request, actorId) => {
        const body = validatedRequest<'M-028'>(request);
        if (body.input.gate === undefined || body.input.bundleRef === undefined) {
          return srContext.transitionStage(srCommand(body, actorId), body.input);
        }
        return reviews.transitionStage(gatedTransitionCommand(body, actorId), body.input);
      },
      'M-027': (request, actorId) => {
        const body = validatedRequest<'M-027'>(request);
        return reviews.assessGate(queryContext(body.scope, actorId), body.input);
      },
      'M-045': (request, actorId) => {
        const body = validatedRequest<'M-045'>(request);
        return queries.getBoard(queryContext(body.scope, actorId), body.input);
      },
      'M-047': (request, actorId) => {
        const body = validatedRequest<'M-047'>(request);
        return queries.getSrDetail(queryContext(body.scope, actorId), body.input);
      },
    },
  };
}
