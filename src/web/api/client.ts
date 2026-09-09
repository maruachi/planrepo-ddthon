import type { NoGuard, TargetScope, WriteGuard } from '@/src/contracts/context';
import {
  METHOD_DEFINITIONS,
  type MethodInput,
  type MethodValue,
  type GuardFor,
  type Methods,
  type PublicMethodId,
} from '@/src/contracts/methods';
import type {
  CommandReceipt,
  CommandResult,
  CurrentBasis,
  DomainError,
  MarkdownDownload,
} from '@/src/contracts/results';

type ScopeFields<M extends PublicMethodId> = Methods[M]['scope'] extends 'project'
  ? { readonly projectId: string; readonly srId?: never }
  : Methods[M]['scope'] extends 'sr'
    ? { readonly projectId: string; readonly srId: string }
    : { readonly projectId: string; readonly srId?: string };

type ActorField<M extends PublicMethodId> = M extends 'M-002'
  ? { readonly actorId?: never }
  : { readonly actorId: string };

type CommandFields<M extends PublicMethodId> = Methods[M]['mode'] extends 'command'
  ? {
  readonly requestId?: string;
  readonly idempotencyKey?: string;
      readonly guard?: GuardFor<M> extends NoGuard ? never : Extract<GuardFor<M>, WriteGuard>;
    }
  : { readonly requestId?: never; readonly idempotencyKey?: never; readonly guard?: never };

export type BrowserInvokeScope<M extends PublicMethodId> = ScopeFields<M> & ActorField<M> & CommandFields<M>;

export type BrowserInvokeResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly disposition: 'Query' | 'Committed' | 'Replayed';
      readonly receipt?: CommandReceipt;
      readonly current?: CurrentBasis;
    }
  | {
      readonly ok: false;
      readonly error: DomainError;
      readonly priorReceipt?: CommandReceipt;
    };

export class TransportUncertainError extends Error {
  constructor(readonly cause: unknown) {
    super('서버가 요청을 확정했는지 확인할 수 없습니다.');
    this.name = 'TransportUncertainError';
  }
}

function fallbackError(value: unknown): DomainError {
  const body = isObject(value) ? value : {};
  return {
    code: typeof body.code === 'string'
      ? body.code as DomainError['code']
      : 'STORE_UNAVAILABLE',
    message: typeof body.message === 'string' ? body.message : '요청이 거절됐습니다.',
    blockers: [],
    assigneeIds: [],
    targetRefs: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isScope(value: unknown): boolean {
  return isObject(value) && isString(value.projectId) && (
    value.kind === 'project' ||
    (value.kind === 'sr' && isString(value.srId))
  );
}

const ENTITY_KINDS = new Set([
  'project', 'sr', 'sr_description', 'context_source', 'artifact', 'question',
  'question_answer', 'question_result', 'decision', 'scope_classification',
  'review_policy', 'review_assignment', 'review_bundle', 'review_gate_state',
  'review_request', 'approval', 'comment', 'change_request', 'change_request_event',
  'input_snapshot', 'generation_run', 'generation_draft', 'draft_application',
  'handoff', 'implementation', 'activity',
]);
const SR_VERSION_KINDS = new Set([
  'sr_description', 'context_source', 'artifact', 'question_answer', 'question_result',
  'decision', 'scope_classification', 'review_assignment', 'handoff',
]);

function isEntityRef(value: unknown): boolean {
  if (!isObject(value) || !isString(value.kind) || !ENTITY_KINDS.has(value.kind) ||
    !isString(value.projectId) || !isString(value.entityId)) return false;
  if (value.kind === 'project' || value.kind === 'review_policy') return value.srId === undefined;
  if (value.kind === 'activity') return value.srId === undefined || isString(value.srId);
  return isString(value.srId);
}

function isVersionRef(value: unknown): boolean {
  if (!isObject(value) || !isEntityRef(value) || !Number.isInteger(value.version) ||
    Number(value.version) < 1) return false;
  return value.kind === 'review_policy' || (isString(value.kind) && SR_VERSION_KINDS.has(value.kind));
}

function isSnapshotContentRef(value: unknown): boolean {
  if (!isObject(value)) return false;
  return 'version' in value ? isVersionRef(value) : isEntityRef(value);
}

function isBundleRef(value: unknown): boolean {
  return isObject(value) && isString(value.projectId) && isString(value.srId) &&
    (value.gate === 'G1' || value.gate === 'G2') && isString(value.bundleId) &&
    isNumber(value.version);
}

function isReviewImpact(value: unknown): boolean {
  return isObject(value) && Array.isArray(value.affectedGates) &&
    value.affectedGates.every((gate) => gate === 'G1' || gate === 'G2') &&
    typeof value.needsNewReview === 'boolean' &&
    isStringArray(value.carriedBlockingRequestIds) &&
    typeof value.currentHandoffValid === 'boolean' &&
    (value.returnStage === undefined || isString(value.returnStage));
}

function isGate(value: unknown): value is 'G1' | 'G2' {
  return value === 'G1' || value === 'G2';
}

function isPolicyRef(value: unknown, projectId?: string): boolean {
  return isVersionRef(value) && isObject(value) && value.kind === 'review_policy' &&
    (projectId === undefined || value.projectId === projectId);
}

function isGatePolicy(value: unknown): boolean {
  return isObject(value) && Array.isArray(value.requiredRoles) && value.requiredRoles.length > 0 &&
    value.requiredRoles.every(isString) && Array.isArray(value.checklist) && value.checklist.length > 0 &&
    value.checklist.every((item) => isObject(item) && isString(item.itemId) && isString(item.label));
}

function isPolicyView(value: unknown, projectId?: string): boolean {
  return isObject(value) && isPolicyRef(value.policyRef, projectId) &&
    (value.description === undefined || isString(value.description)) && isObject(value.gates) &&
    isGatePolicy(value.gates.G1) && isGatePolicy(value.gates.G2);
}

function isReviewAssignmentView(value: unknown, scope?: SrCodecScope, gate?: 'G1' | 'G2'): boolean {
  return isObject(value) && isVersionRefOf(value.assignmentRef, 'review_assignment') &&
    (scope === undefined || isVersionRefInScope(value.assignmentRef, scope, 'review_assignment')) &&
    isGate(value.gate) && (gate === undefined || value.gate === gate) &&
    isStringArray(value.reviewerIds) && typeof value.ready === 'boolean' &&
    (value.notReadyReason === undefined || isString(value.notReadyReason));
}

function isReviewRequestInput(value: unknown, scope: SrCodecScope, gate: 'G1' | 'G2'): boolean {
  if (!isObject(value) || value.gate !== gate || !Array.isArray(value.artifactVersionRefs) ||
    !value.artifactVersionRefs.every((ref) => isVersionRefInScope(ref, scope, 'artifact')) ||
    !Array.isArray(value.decisionVersionRefs) ||
    !value.decisionVersionRefs.every((ref) => isVersionRefInScope(ref, scope, 'decision')) ||
    !Array.isArray(value.questionResultRefs) ||
    !value.questionResultRefs.every((ref) => isVersionRefInScope(ref, scope, 'question_result')) ||
    !Array.isArray(value.classificationRefs) ||
    !value.classificationRefs.every((ref) => isVersionRefInScope(ref, scope, 'scope_classification')) ||
    !Array.isArray(value.contextSourceVersionRefs) ||
    !value.contextSourceVersionRefs.every((ref) => isVersionRefInScope(ref, scope, 'context_source')) ||
    !isVersionRefInScope(value.assignmentRef, scope, 'review_assignment') ||
    !isStringArray(value.reviewerIds) || !isPolicyRef(value.policyRef, scope.projectId) ||
    !Array.isArray(value.unconfirmedDecisionSnapshots)) return false;
  if (!value.unconfirmedDecisionSnapshots.every((item) => isObject(item) && isString(item.decisionId) &&
    isNumber(item.revision) && isString(item.prompt) && Array.isArray(item.alternatives) && item.alternatives.length > 0 &&
    item.alternatives.every((alternative) => isObject(alternative) && isString(alternative.optionId) &&
      isString(alternative.label) && isString(alternative.description)) && isString(item.impact) &&
    isString(item.decisionMakerId) && isVersionRefInScope(item.classificationRef, scope, 'scope_classification'))) return false;
  return gate === 'G1' ? value.g1BundleRef === undefined : isBundleRef(value.g1BundleRef) &&
    isObject(value.g1BundleRef) && value.g1BundleRef.projectId === scope.projectId &&
    value.g1BundleRef.srId === scope.srId && value.g1BundleRef.gate === 'G1';
}

function isReviewPreparation(value: unknown, scope: SrCodecScope): boolean {
  if (!isObject(value) || !isGate(value.gate) || !Number.isInteger(value.gateRevision) ||
    Number(value.gateRevision) < 0) return false;
  if (value.kind === 'NeedsInputs') {
    return isStringArray(value.missing) && isStringArray(value.assigneeIds);
  }
  return value.kind === 'Ready' && isReviewRequestInput(value.input, scope, value.gate) &&
    Array.isArray(value.checklistSnapshot) && value.checklistSnapshot.length > 0 &&
    value.checklistSnapshot.every((item) => isObject(item) && isString(item.itemId) && isString(item.label));
}

function isReviewConfiguration(value: unknown, scope: SrCodecScope): boolean {
  if (!isObject(value) || !isGate(value.gate) || !Number.isInteger(value.reviewEpoch) ||
    Number(value.reviewEpoch) < 0 || !Number.isInteger(value.revision) || Number(value.revision) < 0 ||
    typeof value.needsNewBundle !== 'boolean' ||
    !['not_passed', 'valid', 'invalid'].includes(String(value.validity)) ||
    (value.policy !== undefined && !isPolicyView(value.policy, scope.projectId)) ||
    (value.assignment !== undefined && !isReviewAssignmentView(value.assignment, scope, value.gate)) ||
    (value.lastPassTransitionId !== undefined && !isString(value.lastPassTransitionId))) return false;
  return value.currentBundleRef === undefined || (isBundleRef(value.currentBundleRef) &&
    isObject(value.currentBundleRef) && value.currentBundleRef.projectId === scope.projectId &&
    value.currentBundleRef.srId === scope.srId && value.currentBundleRef.gate === value.gate);
}

function isReviewBundleView(value: unknown, scope: SrCodecScope, gate: 'G1' | 'G2'): boolean {
  if (!isObject(value)) return false;
  if (value.kind === 'NeedsInputs') {
    return value.gate === gate && isStringArray(value.missing) && isStringArray(value.assigneeIds);
  }
  return value.kind === 'BundleAvailable' && isReviewBundleSnapshot(value.bundle, scope, gate) &&
    isStringArray(value.requestIds);
}

function isReviewBundleSnapshot(value: unknown, scope: SrCodecScope, gate?: 'G1' | 'G2'): boolean {
  if (!isObject(value) || !isBundleRefInScope(value.bundleRef, scope) || !isObject(value.bundleRef) ||
    (gate !== undefined && value.bundleRef.gate !== gate) || !Number.isInteger(value.reviewEpoch) || Number(value.reviewEpoch) < 0 ||
    !Array.isArray(value.artifactVersionRefs) || !value.artifactVersionRefs.every((ref) => isVersionRefInScope(ref, scope, 'artifact')) ||
    !Array.isArray(value.decisionVersionRefs) || !value.decisionVersionRefs.every((ref) => isVersionRefInScope(ref, scope, 'decision')) ||
    !Array.isArray(value.questionResultRefs) || !value.questionResultRefs.every((ref) => isVersionRefInScope(ref, scope, 'question_result')) ||
    !Array.isArray(value.classificationRefs) || !value.classificationRefs.every((ref) => isVersionRefInScope(ref, scope, 'scope_classification')) ||
    !Array.isArray(value.contextSourceVersionRefs) || !value.contextSourceVersionRefs.every((ref) => isVersionRefInScope(ref, scope, 'context_source')) ||
    !isVersionRefInScope(value.assignmentRef, scope, 'review_assignment') || !isStringArray(value.reviewerIds) ||
    !isPolicyRef(value.policyRef, scope.projectId) || !Array.isArray(value.checklistSnapshot) || value.checklistSnapshot.length === 0 ||
    !value.checklistSnapshot.every((item) => isObject(item) && isString(item.itemId) && isString(item.label)) ||
    !isVersionRefInScope(value.descriptionRef, scope, 'sr_description') || !isString(value.createdBy) || !isString(value.createdAt) ||
    (value.previousBundleRef !== undefined && !isBundleRefInScope(value.previousBundleRef, scope)) ||
    (value.g1BundleRef !== undefined && (!isBundleRefInScope(value.g1BundleRef, scope) || !isObject(value.g1BundleRef) || value.g1BundleRef.gate !== 'G1')) ||
    !Array.isArray(value.unconfirmedDecisionSnapshots)) return false;
  return value.unconfirmedDecisionSnapshots.every((item) => isObject(item) && isString(item.decisionId) &&
    Number.isInteger(item.revision) && isString(item.prompt) && Array.isArray(item.alternatives) && item.alternatives.length > 0 &&
    item.alternatives.every((alternative) => isObject(alternative) && isString(alternative.optionId) && isString(alternative.label) && isString(alternative.description)) &&
    isString(item.impact) && isString(item.decisionMakerId) && isVersionRefInScope(item.classificationRef, scope, 'scope_classification'));
}

function isReviewRequestView(value: unknown, scope: SrCodecScope): boolean {
  if (!isObject(value) || !isString(value.requestId) || !isBundleRefInScope(value.bundleRef, scope) ||
    !Number.isInteger(value.reviewEpoch) || Number(value.reviewEpoch) < 0 || !isString(value.reviewerId) ||
    !isString(value.requestKind) || !isString(value.requestedBy) || !isString(value.requestedAt) ||
    !Number.isInteger(value.revision) || Number(value.revision) < 0) return false;
  if (value.status === 'pending') return value.resultRef === undefined && value.handledAt === undefined && value.supersededByRequestId === undefined;
  if (value.status === 'handled') return isEntityRef(value.resultRef) && isObject(value.resultRef) && value.resultRef.kind === 'approval' &&
    value.resultRef.projectId === scope.projectId && value.resultRef.srId === scope.srId && isString(value.handledAt) && value.supersededByRequestId === undefined;
  return value.status === 'superseded' && isString(value.supersededByRequestId) && value.resultRef === undefined;
}

function isApprovalView(value: unknown, scope: SrCodecScope): boolean {
  return isObject(value) && isString(value.approvalId) && isBundleRefInScope(value.bundleRef, scope) &&
    !(!isObject(value.bundleRef) || value.approvalScope !== value.bundleRef.gate) &&
    Number.isInteger(value.reviewEpoch) && Number(value.reviewEpoch) >= 0 && isPolicyRef(value.policyRef, scope.projectId) &&
    isString(value.approverId) && Array.isArray(value.checklistResults) && value.checklistResults.length > 0 &&
    value.checklistResults.every((item) => isObject(item) && isString(item.itemId) && item.checked === true) &&
    value.result === 'approved' && isString(value.approvedAt) && (value.comment === undefined || isString(value.comment));
}

function isGateAssessment(value: unknown, scope: SrCodecScope, gate?: 'G1' | 'G2'): boolean {
  if (!isObject(value) || !isGate(value.gate) || (gate !== undefined && value.gate !== gate) ||
    !Number.isInteger(value.assessedRevision) || Number(value.assessedRevision) < 0 ||
    !Number.isInteger(value.reviewEpoch) || Number(value.reviewEpoch) < 0 ||
    (value.currentBundleRef !== undefined && (!isBundleRefInScope(value.currentBundleRef, scope) || !isObject(value.currentBundleRef) || value.currentBundleRef.gate !== value.gate)) ||
    (value.g1BundleRef !== undefined && (!isBundleRefInScope(value.g1BundleRef, scope) || !isObject(value.g1BundleRef) || value.g1BundleRef.gate !== 'G1')) ||
    !['재검토 필요', '작성 중', '수정 필요', '승인 완료', '검토 중', '검토 요청'].includes(String(value.reviewState)) ||
    typeof value.canTransition !== 'boolean' || !Array.isArray(value.conditions)) return false;
  return value.conditions.every((condition) => isObject(condition) && isString(condition.conditionId) &&
    typeof condition.passed === 'boolean' && isString(condition.reason) && isStringArray(condition.assigneeIds) &&
    Array.isArray(condition.targetRefs) && condition.targetRefs.every((ref) => isEntityRef(ref) && isRefInSrScope(ref, scope)));
}

function sameBundleRef(left: unknown, right: unknown): boolean {
  return isObject(left) && isObject(right) && left.projectId === right.projectId && left.srId === right.srId &&
    left.gate === right.gate && left.bundleId === right.bundleId && left.version === right.version;
}

function isPolicyApplicationResult(value: unknown, scope: SrCodecScope, input: unknown): boolean {
  if (!isObject(value) || !isObject(input) || !isPolicyRef(value.policyRef, scope.projectId) ||
    !sameVersionRef(value.policyRef, input.policyRef) || !Array.isArray(input.gates) || input.gates.length === 0 ||
    !input.gates.every(isGate) || !Array.isArray(value.gates) || value.gates.length !== input.gates.length ||
    !isReviewImpact(value.reviewImpact)) return false;
  const expected = new Set(input.gates);
  return value.gates.every((item) => isObject(item) && isGate(item.gate) && expected.delete(item.gate) &&
    isReviewBundleView(item.result, scope, item.gate)) && expected.size === 0;
}

function isArtifactRefInScope(value: unknown, scope: SrCodecScope): boolean {
  return isVersionRefInScope(value, scope, 'artifact');
}

function isBundleRefInScope(value: unknown, scope: SrCodecScope): boolean {
  return isBundleRef(value) && isObject(value) && value.projectId === scope.projectId && value.srId === scope.srId;
}

function isCommentView(value: unknown, scope: SrCodecScope): boolean {
  return isObject(value) && isString(value.commentId) && isArtifactRefInScope(value.artifactVersionRef, scope) &&
    isString(value.sectionId) && isString(value.body) &&
    (value.bundleRef === undefined || isBundleRefInScope(value.bundleRef, scope)) &&
    isString(value.authorId) && isString(value.createdAt);
}

function isChangeTarget(value: unknown, scope: SrCodecScope): boolean {
  return isArtifactRefInScope(value, scope) || (isObject(value) && value.kind === 'missing_section' && isString(value.sectionId));
}

function isChangeEventRef(value: unknown, scope: SrCodecScope): boolean {
  return isEntityRef(value) && isObject(value) && value.kind === 'change_request_event' &&
    value.projectId === scope.projectId && value.srId === scope.srId;
}

function isChangeRequestEvent(value: unknown, scope: SrCodecScope, changeRequestId: string): boolean {
  if (!isObject(value) || !isChangeEventRef(value.eventRef, scope) || value.changeRequestId !== changeRequestId || !isString(value.actorId) ||
    !isString(value.occurredAt) || !['open', 'awaiting_confirmation', 'resolved'].includes(String(value.beforeStatus)) ||
    !['open', 'awaiting_confirmation', 'resolved'].includes(String(value.afterStatus)) ||
    !isArtifactRefInScope(value.targetArtifactVersionRef, scope)) return false;
  if (value.kind === 'applied') return isString(value.applicationSummary) && isStoredEvidence(value.evidence, scope);
  if (value.kind === 'resolved') return isChangeEventRef(value.applicationEventRef, scope) && isString(value.verification);
  if (value.kind === 'further_change') return isString(value.unresolvedSummary) && isString(value.feedback) &&
    (value.applicationEventRef === undefined || isChangeEventRef(value.applicationEventRef, scope));
  return value.kind === 'carried' && isChangeTarget(value.beforeTargetRef, scope) && isChangeTarget(value.afterTargetRef, scope);
}

function isChangeRequestView(value: unknown, scope: SrCodecScope): boolean {
  if (!isObject(value) || !isString(value.changeRequestId) || !isArtifactRefInScope(value.originalTargetVersionRef, scope) ||
    !isString(value.originalSectionId) || !isString(value.body) || !isGate(value.affectedGate) ||
    !isChangeTarget(value.currentTargetRef, scope) || !['open', 'awaiting_confirmation', 'resolved'].includes(String(value.status)) ||
    typeof value.blocking !== 'boolean' || !isString(value.assigneeId) || !isString(value.requesterId) ||
    !Number.isInteger(value.revision) || Number(value.revision) < 0 || !isString(value.requestedAt) ||
    (value.dueAt !== undefined && !isString(value.dueAt)) ||
    (value.bundleRef !== undefined && !isBundleRefInScope(value.bundleRef, scope)) ||
    (value.currentApplicationEventRef !== undefined && !isChangeEventRef(value.currentApplicationEventRef, scope)) ||
    (value.currentResolutionEventRef !== undefined && !isChangeEventRef(value.currentResolutionEventRef, scope)) ||
    (value.appliedArtifactVersionRef !== undefined && !isArtifactRefInScope(value.appliedArtifactVersionRef, scope)) ||
    !Array.isArray(value.events) || !value.events.every((event) => isChangeRequestEvent(event, scope, value.changeRequestId as string))) return false;
  if (isObject(value.currentTargetRef) && value.currentTargetRef.kind === 'artifact' &&
    isObject(value.originalTargetVersionRef) && value.currentTargetRef.entityId !== value.originalTargetVersionRef.entityId) return false;
  return value.events.every((event) => isObject(event) && isObject(event.eventRef) &&
    event.eventRef.entityId !== '' && isObject(event.targetArtifactVersionRef) &&
    isObject(value.originalTargetVersionRef) && event.targetArtifactVersionRef.entityId === value.originalTargetVersionRef.entityId);
}

function isSrView(value: unknown): boolean {
  return isObject(value) && isObject(value.scope) && isScope(value.scope) && value.scope.kind === 'sr' &&
    isString(value.key) && isString(value.title) && isString(value.ownerId) &&
    isVersionRef(value.originalDescriptionRef) && isVersionRef(value.currentDescriptionRef) &&
    ['sr_received', 'requirements', 'planning', 'ready', 'implementing', 'completed'].includes(String(value.progressStage)) &&
    isNumber(value.revision) && Array.isArray(value.gates) && value.gates.every((gate) =>
      isObject(gate) && (gate.gate === 'G1' || gate.gate === 'G2') &&
      ['not_passed', 'valid', 'invalid'].includes(String(gate.validity)) &&
      isNumber(gate.reviewEpoch) && isStringArray(gate.blockers) &&
      (gate.currentBundleRef === undefined || isBundleRef(gate.currentBundleRef))) &&
    (value.reviewImpact === undefined || isReviewImpact(value.reviewImpact));
}

function isDescriptionView(value: unknown): boolean {
  return isObject(value) && isVersionRef(value.versionRef) && isString(value.title) &&
    isString(value.purpose) && isString(value.description) && isString(value.authorId) &&
    isString(value.createdAt) && (value.changeReason === undefined || isString(value.changeReason));
}

function isContextSourceView(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.scope) || !isScope(value.scope) || value.scope.kind !== 'sr' ||
    !isString(value.sourceId) || !isVersionRef(value.currentVersionRef) ||
    !isNumber(value.revision) || !isString(value.createdBy) || !isString(value.createdAt) ||
    !isString(value.provenance) || !isString(value.versionCreatedBy) ||
    !isString(value.versionCreatedAt) || !isReviewImpact(value.reviewImpact) ||
    (value.displayName !== undefined && !isString(value.displayName)) ||
    (value.previousVersionRef !== undefined && !isVersionRef(value.previousVersionRef))) return false;
  if (value.kind === 'text' || value.kind === 'markdown') {
    if (!isString(value.content)) return false;
  } else if (value.kind === 'link') {
    if (!isString(value.targetUrl) || typeof value.verifiable !== 'boolean' ||
      (value.observedExternalVersion !== undefined && !isString(value.observedExternalVersion)) ||
      (value.unavailableReason !== undefined && !isString(value.unavailableReason))) return false;
  } else return false;
  return value.confirmation === 'unconfirmed'
    ? value.confirmedBy === undefined && value.confirmedAt === undefined && value.confirmationEvidence === undefined
    : value.confirmation === 'confirmed' && isString(value.confirmedBy) &&
      isString(value.confirmedAt) && isString(value.confirmationEvidence);
}

function isVersionRefOf(value: unknown, kind: string): boolean {
  return isVersionRef(value) && isObject(value) && value.kind === kind;
}

function isEntityRefOf(value: unknown, kind: 'question' | 'decision'): boolean {
  return isEntityRef(value) && isObject(value) && value.kind === kind;
}

function sameVersionRef(left: unknown, right: unknown): boolean {
  return isObject(left) && isObject(right) && left.kind === right.kind &&
    left.projectId === right.projectId && left.srId === right.srId &&
    left.entityId === right.entityId && left.version === right.version;
}

function sameEntityRef(left: unknown, right: unknown): boolean {
  return isObject(left) && isObject(right) && left.kind === right.kind &&
    left.projectId === right.projectId && left.srId === right.srId && left.entityId === right.entityId;
}

interface SrCodecScope {
  readonly projectId: string;
  readonly srId: string;
}

function isRefInSrScope(value: unknown, scope: SrCodecScope): boolean {
  return isObject(value) && value.projectId === scope.projectId && (
    value.kind === 'review_policy'
      ? value.srId === undefined
      : value.srId === scope.srId
  );
}

function isVersionRefInScope(value: unknown, scope: SrCodecScope, kind?: string, entityId?: string): boolean {
  return isVersionRef(value) && isObject(value) && isRefInSrScope(value, scope) &&
    (kind === undefined || value.kind === kind) &&
    (entityId === undefined || value.entityId === entityId);
}

function isEntityRefInScope(
  value: unknown,
  scope: SrCodecScope,
  kind: 'question' | 'decision',
  entityId?: string,
): boolean {
  return isEntityRefOf(value, kind) && isObject(value) && isRefInSrScope(value, scope) &&
    (entityId === undefined || value.entityId === entityId);
}

function isEvidenceRef(value: unknown, scope?: SrCodecScope): boolean {
  return (isVersionRef(value) && (scope === undefined || isRefInSrScope(value, scope))) || (
    isObject(value) && value.kind === 'external' && isString(value.label) &&
    isString(value.verificationSummary) && (value.url === undefined || isString(value.url))
  );
}

function isStoredEvidence(value: unknown, scope?: SrCodecScope): boolean {
  return isObject(value) && (
    isString(value.text) || (Array.isArray(value.refs) && value.refs.every((ref) => isEvidenceRef(ref, scope)))
  );
}

function isProposalSource(value: unknown): boolean {
  return isObject(value) && isString(value.draftId) && isString(value.temporaryId);
}

function isCurrentScopeClassification(value: unknown, target?: {
  readonly scope: SrCodecScope;
  readonly kind: 'question' | 'decision';
  readonly entityId: string;
}): boolean {
  if (!isObject(value) || !isVersionRefOf(value.ref, 'scope_classification') ||
    (!isEntityRefOf(value.targetRef, 'question') && !isEntityRefOf(value.targetRef, 'decision')) ||
    !isString(value.reason) || !isString(value.classifiedBy) || !isString(value.classifiedAt) ||
    (value.previousVersionRef !== undefined && !isVersionRefOf(value.previousVersionRef, 'scope_classification')) ||
    !Array.isArray(value.basisRefs) || !value.basisRefs.every(isVersionRef)) return false;
  if (target !== undefined && (
    !isVersionRefInScope(value.ref, target.scope, 'scope_classification') ||
    !isEntityRefInScope(value.targetRef, target.scope, target.kind, target.entityId) ||
    (value.previousVersionRef !== undefined && (
      !isVersionRefInScope(value.previousVersionRef, target.scope, 'scope_classification') ||
      !isObject(value.ref) || !isObject(value.previousVersionRef) ||
      value.previousVersionRef.entityId !== value.ref.entityId
    )) ||
    !value.basisRefs.every((ref) => isVersionRefInScope(ref, target.scope))
  )) return false;
  if (value.scope === 'current') return value.requiredGate === 'G1' || value.requiredGate === 'G2';
  if (value.scope !== 'followup' || value.requiredGate !== 'None' || !isString(value.ownerId) ||
    !isObject(value.revisit)) return false;
  return (value.revisit.kind === 'at' && isString(value.revisit.at)) ||
    (value.revisit.kind === 'event' && isString(value.revisit.event));
}

function isQuestionResolution(value: unknown, scope?: SrCodecScope): boolean {
  if (!isObject(value) || !isVersionRefOf(value.selectedAnswerRef, 'question_answer') ||
    (scope !== undefined && !isVersionRefInScope(value.selectedAnswerRef, scope, 'question_answer')) ||
    !isStoredEvidence(value.evidence, scope) || !isString(value.resolvedBy) || !isString(value.resolvedAt) ||
    !isObject(value.documentDisposition)) return false;
  return value.documentDisposition.kind === 'not_required'
    ? isString(value.documentDisposition.reason)
    : value.documentDisposition.kind === 'reflected' &&
      Array.isArray(value.documentDisposition.artifactVersionRefs) &&
      value.documentDisposition.artifactVersionRefs.length > 0 &&
      value.documentDisposition.artifactVersionRefs.every((ref) =>
        isVersionRefOf(ref, 'artifact') && (scope === undefined || isVersionRefInScope(ref, scope, 'artifact')));
}

function isQuestionView(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.scope) || !isScope(value.scope) || value.scope.kind !== 'sr' ||
    !isString(value.questionId) || !isString(value.text) || !isString(value.reason) ||
    !isString(value.assigneeId) || (value.answerMode !== 'choice' && value.answerMode !== 'free_text') ||
    !Array.isArray(value.options) || !value.options.every((option) =>
      isObject(option) && isString(option.optionId) && isString(option.text)) ||
    (value.requiredGate !== 'G1' && value.requiredGate !== 'G2' && value.requiredGate !== 'None') ||
    !isVersionRefOf(value.classificationRef, 'scope_classification') ||
    !isCurrentScopeClassification(value.currentClassification, {
      scope: value.scope as unknown as SrCodecScope, kind: 'question', entityId: value.questionId as string,
    }) ||
    !isObject(value.currentClassification) ||
    !sameVersionRef(value.classificationRef, value.currentClassification.ref) ||
    !isEntityRefOf(value.currentClassification.targetRef, 'question') ||
    !sameEntityRef(value.currentClassification.targetRef, {
      kind: 'question', projectId: value.scope.projectId, srId: value.scope.srId, entityId: value.questionId,
    }) ||
    (value.parentQuestionId !== undefined && !isString(value.parentQuestionId)) ||
    !isStringArray(value.candidateAnswers) || !Array.isArray(value.relatedArtifactRefs) ||
    !value.relatedArtifactRefs.every((ref) => isVersionRefInScope(ref, value.scope as unknown as SrCodecScope, 'artifact')) ||
    !Array.isArray(value.sourceRefs) ||
    !value.sourceRefs.every((ref) => isVersionRefInScope(ref, value.scope as unknown as SrCodecScope)) ||
    (value.dueAt !== undefined && !isString(value.dueAt)) ||
    (value.sourceDraft !== undefined && !isProposalSource(value.sourceDraft)) ||
    !isString(value.createdAt) || !isObject(value.currentResult) ||
    !isVersionRefInScope(value.currentResult.ref, value.scope as unknown as SrCodecScope, 'question_result', value.questionId as string) ||
    !isString(value.currentResult.capturedAt) ||
    !Array.isArray(value.currentResult.evidenceRefs) ||
    !value.currentResult.evidenceRefs.every((ref) => isEvidenceRef(ref, value.scope as unknown as SrCodecScope)) ||
    !['open', 'answered', 'resolved', 'converted_to_decision'].includes(String(value.status)) ||
    (value.convertedDecisionId !== undefined && !isString(value.convertedDecisionId)) ||
    !isNumber(value.revision) || !isStringArray(value.allowedActions) || !isReviewImpact(value.reviewImpact)) return false;
  const selected = value.currentResult.selectedAnswer;
  if (selected !== undefined && (!isObject(selected) || !isVersionRefOf(selected.ref, 'question_answer') ||
    !isVersionRefInScope(selected.ref, value.scope as unknown as SrCodecScope, 'question_answer') ||
    !isVersionRefInScope(selected.answeredQuestionSnapshotRef, value.scope as unknown as SrCodecScope,
      'question_result', value.questionId as string) || !isObject(selected.answer) ||
    !isString(selected.answer.text) || (selected.answer.kind !== 'choice' && selected.answer.kind !== 'free_text') ||
    (selected.answer.kind === 'choice' && !isString(selected.answer.optionId)) ||
    !isStoredEvidence(selected.evidence, value.scope as unknown as SrCodecScope) ||
    !isString(selected.answeredBy) || !isString(selected.answeredAt))) return false;
  const resolution = value.currentResult.resolution;
  if (resolution !== undefined && !isQuestionResolution(resolution, value.scope as unknown as SrCodecScope)) return false;
  if (value.requiredGate !== value.currentClassification.requiredGate) return false;
  if (value.status === 'open') return selected === undefined && resolution === undefined && value.convertedDecisionId === undefined;
  if (value.status === 'answered') return selected !== undefined && resolution === undefined && value.convertedDecisionId === undefined;
  if (value.status === 'resolved') return selected !== undefined && resolution !== undefined &&
    value.convertedDecisionId === undefined && isObject(resolution) && sameVersionRef(resolution.selectedAnswerRef, selected.ref);
  return isString(value.convertedDecisionId);
}

function isDecisionView(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.scope) || !isScope(value.scope) || value.scope.kind !== 'sr' ||
    !isString(value.decisionId) || !isString(value.prompt) || !Array.isArray(value.alternatives) ||
    !value.alternatives.every((alternative) => isObject(alternative) && isString(alternative.optionId) &&
      isString(alternative.label) && isString(alternative.description)) || !isString(value.impact) ||
    !isString(value.decisionMakerId) ||
    (value.requiredGate !== 'G1' && value.requiredGate !== 'G2' && value.requiredGate !== 'None') ||
    !isVersionRefOf(value.classificationRef, 'scope_classification') ||
    !isCurrentScopeClassification(value.currentClassification, {
      scope: value.scope as unknown as SrCodecScope, kind: 'decision', entityId: value.decisionId as string,
    }) ||
    !isObject(value.currentClassification) ||
    !sameVersionRef(value.classificationRef, value.currentClassification.ref) ||
    !isEntityRefOf(value.currentClassification.targetRef, 'decision') ||
    !sameEntityRef(value.currentClassification.targetRef, {
      kind: 'decision', projectId: value.scope.projectId, srId: value.scope.srId, entityId: value.decisionId,
    }) ||
    (value.recommendation !== undefined && !isString(value.recommendation)) ||
    !Array.isArray(value.sourceRefs) ||
    !value.sourceRefs.every((ref) => isVersionRefInScope(ref, value.scope as unknown as SrCodecScope)) ||
    (value.originQuestionId !== undefined && !isString(value.originQuestionId)) ||
    (value.originQuestionResultSnapshotRef !== undefined &&
      !isVersionRefInScope(value.originQuestionResultSnapshotRef, value.scope as unknown as SrCodecScope,
        'question_result', value.originQuestionId as string)) ||
    (value.sourceDraft !== undefined && !isProposalSource(value.sourceDraft)) ||
    !isString(value.createdBy) || !isString(value.createdAt) ||
    (value.state !== 'unconfirmed' && value.state !== 'confirmed') || !isNumber(value.revision) ||
    !isStringArray(value.allowedActions) || !isReviewImpact(value.reviewImpact) ||
    value.requiredGate !== value.currentClassification.requiredGate ||
    ((value.originQuestionId === undefined) !== (value.originQuestionResultSnapshotRef === undefined))) return false;
  const confirmation = value.currentConfirmation;
  if (confirmation === undefined) return value.state === 'unconfirmed';
  return value.state === 'confirmed' && isObject(confirmation) &&
    isVersionRefInScope(confirmation.ref, value.scope as unknown as SrCodecScope, 'decision', value.decisionId as string) &&
    isObject(confirmation.selection) && isString(confirmation.selection.text) &&
    (confirmation.selection.optionId === undefined || isString(confirmation.selection.optionId)) &&
    isString(confirmation.rationale) && isStoredEvidence(confirmation.evidence, value.scope as unknown as SrCodecScope) &&
    isString(confirmation.decidedBy) && isString(confirmation.decidedAt) &&
    isVersionRefInScope(confirmation.classificationRef, value.scope as unknown as SrCodecScope, 'scope_classification') &&
    isObject(value.classificationRef) && isObject(confirmation.classificationRef) &&
    confirmation.classificationRef.entityId === value.classificationRef.entityId &&
    (confirmation.originQuestionId === undefined || isString(confirmation.originQuestionId)) &&
    (confirmation.originQuestionResultSnapshotRef === undefined ||
      isVersionRefInScope(confirmation.originQuestionResultSnapshotRef, value.scope as unknown as SrCodecScope,
        'question_result', confirmation.originQuestionId as string)) &&
    ((confirmation.originQuestionId === undefined) === (confirmation.originQuestionResultSnapshotRef === undefined)) &&
    confirmation.originQuestionId === value.originQuestionId &&
    sameOptionalVersionRef(confirmation.originQuestionResultSnapshotRef, value.originQuestionResultSnapshotRef) &&
    (confirmation.previousVersionRef === undefined ||
      isVersionRefInScope(confirmation.previousVersionRef, value.scope as unknown as SrCodecScope,
        'decision', value.decisionId as string)) &&
    (confirmation.changeReason === undefined || isString(confirmation.changeReason));
}

function sameOptionalVersionRef(left: unknown, right: unknown): boolean {
  return left === undefined && right === undefined || sameVersionRef(left, right);
}

function isScopeView(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.targetRef) ||
    (!isEntityRefOf(value.targetRef, 'question') && !isEntityRefOf(value.targetRef, 'decision')) ||
    !isVersionRefOf(value.classificationRef, 'scope_classification') ||
    !isCurrentScopeClassification(value.classification, {
      scope: value.targetRef as unknown as SrCodecScope,
      kind: value.targetRef.kind as 'question' | 'decision',
      entityId: value.targetRef.entityId as string,
    }) || !isObject(value.classification) ||
    !sameVersionRef(value.classificationRef, value.classification.ref) ||
    !sameEntityRef(value.classification.targetRef, value.targetRef) ||
    value.scope !== value.classification.scope || value.requiredGate !== value.classification.requiredGate ||
    !isNumber(value.revision) || !isReviewImpact(value.reviewImpact)) return false;
  return true;
}

function isArtifactView(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.scope) || !isScope(value.scope) || value.scope.kind !== 'sr' ||
    !isString(value.artifactId) ||
    !['requirements', 'workflow_plan', 'design', 'implementation_plan'].includes(String(value.kind)) ||
    (value.kind === 'design'
      ? !['application', 'functional', 'nfr', 'infrastructure'].includes(String(value.designStage))
      : value.designStage !== undefined) ||
    !isVersionRefOf(value.versionRef, 'artifact') || !isString(value.markdown) ||
    !Array.isArray(value.sectionIndex) || !value.sectionIndex.every((section) =>
      isObject(section) && isString(section.sectionId) && isString(section.title) &&
      isNumber(section.startOffset) && isNumber(section.endOffset)) ||
    !Array.isArray(value.requirementLinks) || !value.requirementLinks.every((link) =>
      isObject(link) && isString(link.requirementId) && isStringArray(link.sectionIds) &&
      link.sectionIds.length > 0 && isStringArray(link.acceptanceCriteria)) ||
    (value.authorOrigin !== 'human' && value.authorOrigin !== 'ai_applied') ||
    !isString(value.authorId) || !isString(value.createdAt) || !isString(value.changeSummary) ||
    (value.previousVersionRef !== undefined && !isVersionRefOf(value.previousVersionRef, 'artifact')) ||
    (value.draftApplicationId !== undefined && !isString(value.draftApplicationId)) ||
    (value.inputSnapshotId !== undefined && !isString(value.inputSnapshotId)) ||
    !Array.isArray(value.decisionRefs) || !value.decisionRefs.every((ref) => isVersionRefOf(ref, 'decision')) ||
    !Array.isArray(value.sourceRefs) || !value.sourceRefs.every((ref) => isVersionRefOf(ref, 'context_source')) ||
    !Array.isArray(value.questionResultRefs) ||
    !value.questionResultRefs.every((ref) => isVersionRefOf(ref, 'question_result')) ||
    !isNumber(value.revision) || !isReviewImpact(value.reviewImpact)) return false;
  if (value.kind !== 'workflow_plan') return true;
  return value.workflowVersion === 'v1.0.1' && value.implementationUnitCount === 1 &&
    Array.isArray(value.stages) && value.stages.every((stage) => isObject(stage) && isString(stage.stageId) && (
      (stage.choice === 'executed' && Array.isArray(stage.designArtifactRefs) &&
        stage.designArtifactRefs.every((ref) => isVersionRefOf(ref, 'artifact'))) ||
      (stage.choice === 'skipped' && isString(stage.reason))
    )) && Array.isArray(value.requirementTaskLinks) && value.requirementTaskLinks.every((link) =>
      isObject(link) && isString(link.taskId) && isStringArray(link.requirementIds) &&
      link.requirementIds.length > 0 && isStringArray(link.verification) && link.verification.length > 0 &&
      isNumber(link.order));
}

function isArtifactDiffView(value: unknown): boolean {
  return isObject(value) && isArtifactView(value.before) && isArtifactView(value.after) &&
    isStringArray(value.changedRequirementIds) && isStringArray(value.changedSectionIds) &&
    Array.isArray(value.changedDecisionRefs) &&
    value.changedDecisionRefs.every((ref) => isVersionRefOf(ref, 'decision'));
}

const GENERATION_TASK_KINDS = [
  'QUESTION_PROPOSALS', 'DECISION_PROPOSALS', 'ARTIFACT_DRAFT', 'ARTIFACT_REVISION',
] as const;
const DOCUMENT_KINDS = ['requirements', 'workflow_plan', 'design', 'implementation_plan'] as const;

function isOneOf(value: unknown, choices: readonly string[]): value is string {
  return typeof value === 'string' && choices.includes(value);
}

function isArtifactTargetBasis(value: unknown): boolean {
  return isObject(value) && (
    (value.kind === 'absent' && isString(value.logicalKey)) ||
    (value.kind === 'version' && isVersionRefOf(value.ref, 'artifact'))
  );
}

function isGenerationInput(value: unknown): boolean {
  if (!isObject(value) || !isOneOf(value.taskKind, GENERATION_TASK_KINDS) ||
    (value.supplement !== undefined && !isString(value.supplement))) return false;
  if (value.taskKind === 'QUESTION_PROPOSALS' || value.taskKind === 'DECISION_PROPOSALS') {
    return value.documentKind === undefined && value.targetBasis === undefined;
  }
  return isOneOf(value.documentKind, DOCUMENT_KINDS) && isArtifactTargetBasis(value.targetBasis) &&
    (value.taskKind === 'ARTIFACT_DRAFT'
      ? isObject(value.targetBasis) && value.targetBasis.kind === 'absent'
      : isObject(value.targetBasis) && value.targetBasis.kind === 'version');
}

function isQuestionProposal(value: unknown): boolean {
  return isObject(value) && isString(value.temporaryId) && isString(value.text) &&
    isString(value.reason) && isString(value.suggestedAssigneeId) &&
    (value.requiredGate === 'G1' || value.requiredGate === 'G2') &&
    Array.isArray(value.sourceRefs) && value.sourceRefs.every(isVersionRef) &&
    isStringArray(value.candidateAnswers);
}

function isDecisionProposal(value: unknown): boolean {
  return isObject(value) && isString(value.temporaryId) && isString(value.prompt) &&
    Array.isArray(value.alternatives) && value.alternatives.length > 0 &&
    value.alternatives.every((item) => isObject(item) && isString(item.optionId) &&
      isString(item.label) && isString(item.description)) && isString(value.impact) &&
    isString(value.recommendation) && Array.isArray(value.sourceRefs) && value.sourceRefs.every(isVersionRef);
}

function isGenerationResult(value: unknown): boolean {
  if (!isObject(value) || value.schemaVersion !== 1) return false;
  if (value.kind === 'question_proposals') {
    return Array.isArray(value.proposals) && value.proposals.length > 0 &&
      value.proposals.every(isQuestionProposal);
  }
  if (value.kind === 'decision_proposals') {
    return Array.isArray(value.proposals) && value.proposals.length > 0 &&
      value.proposals.every(isDecisionProposal);
  }
  return value.kind === 'artifact' && isOneOf(value.documentKind, DOCUMENT_KINDS) &&
    isString(value.markdown) && isStringArray(value.requirementRefs) && isString(value.changeSummary);
}

function isInputFreshness(value: unknown): boolean {
  return value === 'current' || value === 'stale' ||
    (isObject(value) && value.kind === 'unknown' && isString(value.reason));
}

function isDraftApplicationResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind === 'artifact') return isVersionRefOf(value.artifactVersionRef, 'artifact');
  if (value.kind !== 'questions' && value.kind !== 'decisions') return false;
  const refKind = value.kind === 'questions' ? 'question' : 'decision';
  return Array.isArray(value.mappings) && value.mappings.length > 0 && value.mappings.every((mapping) =>
    isObject(mapping) && isString(mapping.temporaryId) && isObject(mapping.ref) &&
    mapping.ref.kind === refKind && isEntityRef(mapping.ref));
}

function isDraftApplicationStatus(value: unknown): boolean {
  return isObject(value) && (
    value.kind === 'not_applied' ||
    (value.kind === 'applied' && isString(value.applicationId) && isDraftApplicationResult(value.result))
  );
}

function isDraftProvenance(value: unknown): boolean {
  return isObject(value) && (
    (value.kind === 'provider' && isString(value.sourceRunId)) ||
    (value.kind === 'human_review' && isString(value.sourceDraftId) && isString(value.reviewedBy) &&
      isString(value.reviewedAt) && isString(value.comparisonSummary))
  );
}

function isGenerationDraftIndex(value: unknown): boolean {
  return isObject(value) && isString(value.draftId) &&
    isOneOf(value.taskKind, GENERATION_TASK_KINDS) && isString(value.basisInputSnapshotRef) &&
    isString(value.basisFingerprint) && isDraftProvenance(value.provenance) &&
    isInputFreshness(value.freshness) && isDraftApplicationStatus(value.application);
}

function isDraftView(value: unknown): boolean {
  return isGenerationDraftIndex(value) && isObject(value) && value.schemaVersion === 1 &&
    isGenerationResult(value.body) &&
    (value.staleReason === undefined || isString(value.staleReason));
}

function isInputSnapshot(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.scope) || !isScope(value.scope) || value.scope.kind !== 'sr' ||
    !isString(value.snapshotId) || value.workflowVersion !== 'v1.0.1' ||
    !isString(value.contentFingerprint) || !Array.isArray(value.contents) ||
    !value.contents.every((item) => isObject(item) && isSnapshotContentRef(item.ref) &&
      isString(item.content) && ['confirmed', 'unconfirmed', 'not_applicable'].includes(String(item.confirmation))) ||
    !Array.isArray(value.projectRules) || !value.projectRules.every((rule) =>
      isObject(rule) && isString(rule.logicalId) && isString(rule.version) && isString(rule.content)) ||
    (value.supplement !== undefined && !isString(value.supplement)) || !isString(value.capturedAt) ||
    !isOneOf(value.taskKind, GENERATION_TASK_KINDS)) return false;
  if (value.taskKind === 'QUESTION_PROPOSALS' || value.taskKind === 'DECISION_PROPOSALS') {
    return value.documentKind === undefined && value.targetBasis === undefined;
  }
  return isOneOf(value.documentKind, DOCUMENT_KINDS) && isArtifactTargetBasis(value.targetBasis) &&
    (value.taskKind === 'ARTIFACT_DRAFT'
      ? isObject(value.targetBasis) && value.targetBasis.kind === 'absent'
      : isObject(value.targetBasis) && value.targetBasis.kind === 'version');
}

function isGenerationPreparation(value: unknown): boolean {
  if (!isObject(value) || !isGenerationInput(value.input) || !isString(value.expectedInputFingerprint) ||
    !Array.isArray(value.basisRefs) || !value.basisRefs.every(isVersionRef) ||
    !Array.isArray(value.projectRuleVersions) || !value.projectRuleVersions.every((rule) =>
      isObject(rule) && isString(rule.logicalId) && isString(rule.version))) return false;
  if (value.kind === 'new_generation') return true;
  if (value.kind === 'retry') return isString(value.runId);
  return value.kind === 'draft' && isString(value.draftId) && isString(value.draftBasisFingerprint) &&
    isString(value.currentInputFingerprint) && (value.freshness === 'current' || value.freshness === 'stale') &&
    (value.draftTargetBasis === undefined || isArtifactTargetBasis(value.draftTargetBasis)) &&
    (value.currentTargetBasis === undefined || isArtifactTargetBasis(value.currentTargetBasis));
}

function isAppliedDraftView(value: unknown): boolean {
  return isObject(value) && isString(value.applicationId) && isString(value.draftId) &&
    isDraftApplicationResult(value.result) && isReviewImpact(value.reviewImpact);
}

function isCommandReceipt(value: unknown): value is CommandReceipt {
  return isObject(value) && isScope(value.scope) && isString(value.receiptId) &&
    isObject(value.actorRef) && isString(value.actorRef.actorId) &&
    isString(value.actorRef.projectId) && isString(value.commandKind) &&
    isString(value.requestId) && isString(value.idempotencyKey) &&
    isString(value.inputFingerprint) && isNumber(value.committedRevision) &&
    Array.isArray(value.resultRefs) && isString(value.committedAt);
}

function isCurrentBasis(value: unknown): value is CurrentBasis {
  return isObject(value) && isEntityRef(value.target) && isStringArray(value.allowedActions) &&
    (value.currentRevision === undefined || isNumber(value.currentRevision)) &&
    (value.currentBundleRef === undefined || isBundleRef(value.currentBundleRef)) &&
    (value.reviewEpoch === undefined || isNumber(value.reviewEpoch)) &&
    (value.inputFingerprint === undefined || isString(value.inputFingerprint)) &&
    (value.validity === undefined || ['not_passed', 'valid', 'invalid'].includes(String(value.validity)));
}

function matchesSrScope(value: unknown, scope: TargetScope): boolean {
  return scope.kind === 'sr' && isObject(value) && isObject(value.scope) &&
    value.scope.kind === 'sr' && value.scope.projectId === scope.projectId && value.scope.srId === scope.srId;
}

function matchesQuestionDecisionCommand(
  method: 'M-009' | 'M-011' | 'M-013' | 'M-014',
  value: unknown,
  scope: TargetScope,
  input: unknown,
): boolean {
  if (scope.kind !== 'sr' || !isObject(input) || !isObject(value)) return false;
  if (method === 'M-009') {
    return isQuestionView(value) && matchesSrScope(value, scope) && value.questionId === input.questionId &&
      value.status === 'resolved' && isObject(value.currentResult) && isObject(value.currentResult.resolution) &&
      sameVersionRef(value.currentResult.resolution.selectedAnswerRef, input.selectedAnswerRef);
  }
  if (method === 'M-011') {
    return isDecisionView(value) && matchesSrScope(value, scope) && value.state === 'unconfirmed' &&
      value.originQuestionId === input.questionId &&
      sameVersionRef(value.originQuestionResultSnapshotRef, input.questionResultSnapshotRef);
  }
  if (method === 'M-013') {
    return isDecisionView(value) && matchesSrScope(value, scope) && value.decisionId === input.decisionId &&
      value.state === 'confirmed' && isObject(value.currentConfirmation) &&
      sameVersionRef(value.currentConfirmation.previousVersionRef, input.previousVersionRef);
  }
  return isScopeView(value) && isEntityRef(value.targetRef) && sameEntityRef(value.targetRef, input.targetRef) &&
    isRefInSrScope(value.targetRef, scope) && value.scope === input.scope && value.requiredGate === input.requiredGate;
}

function hasConsistentQuestionDecisionLinks(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.questions) || !Array.isArray(value.decisions)) return false;
  const questions = value.questions.filter(isObject);
  const decisions = value.decisions.filter(isObject);
  for (const question of questions) {
    if (question.status !== 'converted_to_decision') continue;
    if (!isString(question.questionId) || !isString(question.convertedDecisionId)) return false;
    const linked = decisions.find((decision) => decision.decisionId === question.convertedDecisionId);
    if (linked === undefined || linked.originQuestionId !== question.questionId ||
      !isObject(linked.originQuestionResultSnapshotRef) || !isObject(question.currentResult) ||
      !isObject(question.currentResult.ref) ||
      !isNumber(linked.originQuestionResultSnapshotRef.version) || !isNumber(question.currentResult.ref.version) ||
      linked.originQuestionResultSnapshotRef.version >= question.currentResult.ref.version) return false;
  }
  for (const decision of decisions) {
    if (decision.originQuestionId === undefined) continue;
    const linked = questions.find((question) => question.questionId === decision.originQuestionId);
    if (linked === undefined || linked.status !== 'converted_to_decision' ||
      linked.convertedDecisionId !== decision.decisionId) return false;
  }
  return true;
}

function isMethodValue(method: PublicMethodId, value: unknown, requestScope?: TargetScope, input?: unknown): boolean {
  switch (method) {
    case 'M-001':
      if (!isObject(value) || !isObject(value.project) || !isString(value.project.projectId)) return false;
      const workspaceProjectId = value.project.projectId;
      return (
        isString(value.project.teamId) && isString(value.project.name) && Array.isArray(value.actors) &&
        value.actors.every((actor) => isObject(actor) && isString(actor.actorId) &&
          isString(actor.displayName) && actor.projectId === workspaceProjectId && isStringArray(actor.roles) && actor.demo === true) &&
        isObject(value.connection) && value.connection.kind === 'mock' &&
        typeof value.connection.available === 'boolean' && isNumber(value.revision) &&
        Array.isArray(value.policies) && value.policies.every((policy) => isPolicyView(policy, workspaceProjectId)) &&
        (value.defaultPolicyRef === undefined || isPolicyRef(value.defaultPolicyRef, workspaceProjectId)) &&
        (value.defaultPolicyRef === undefined || value.policies.some((policy) =>
          isObject(policy) && sameVersionRef(policy.policyRef, value.defaultPolicyRef))) &&
        (requestScope === undefined || requestScope.kind !== 'project' || workspaceProjectId === requestScope.projectId));
    case 'M-002':
      return isObject(value) && isString(value.actorId) && isString(value.displayName) &&
        isString(value.projectId) && isStringArray(value.roles) && value.demo === true;
    case 'M-003':
    case 'M-005':
      return isSrView(value);
    case 'M-004':
      return isObject(value) && (value.kind === 'Imported' || value.kind === 'Existing') &&
        isSrView(value.sr) && (value.kind === 'Imported' || isString(value.ticketKey));
    case 'M-006':
    case 'M-007':
      return isContextSourceView(value);
    case 'M-008':
    case 'M-010':
      return isQuestionView(value) && requestScope !== undefined && matchesSrScope(value, requestScope);
    case 'M-009':
      return requestScope !== undefined &&
        matchesQuestionDecisionCommand('M-009', value, requestScope, input);
    case 'M-011':
      return requestScope !== undefined &&
        matchesQuestionDecisionCommand('M-011', value, requestScope, input);
    case 'M-012':
      return isDecisionView(value) && requestScope !== undefined && matchesSrScope(value, requestScope);
    case 'M-013':
      return requestScope !== undefined &&
        matchesQuestionDecisionCommand('M-013', value, requestScope, input);
    case 'M-014':
      return requestScope !== undefined &&
        matchesQuestionDecisionCommand('M-014', value, requestScope, input);
    case 'M-015':
    case 'M-017':
      return isArtifactView(value);
    case 'M-016':
      return isArtifactDiffView(value);
    case 'M-018':
      return isAppliedDraftView(value);
    case 'M-019':
      return isDraftView(value);
    case 'M-020':
      return requestScope?.kind === 'sr' && isObject(input) && isGate(input.gate) &&
        isReviewBundleView(value, requestScope, input.gate);
    case 'M-021':
      return requestScope?.kind === 'sr' && isObject(input) && isObject(value) &&
        isApprovalView(value, requestScope) && sameBundleRef(value.bundleRef, input.bundleRef) &&
        value.reviewEpoch === input.reviewEpoch && value.approvalScope === input.approvalScope;
    case 'M-027':
      return requestScope?.kind === 'sr' && isGate(input) && isGateAssessment(value, requestScope, input);
    case 'M-028':
      return requestScope?.kind === 'sr' && isObject(input) && isObject(value) && isSrView(value) &&
        matchesSrScope(value, requestScope) && value.progressStage === input.toStage;
    case 'M-029':
      if (!isPolicyView(value, requestScope?.projectId) || !isObject(value) || !isObject(input) ||
        JSON.stringify(value.gates) !== JSON.stringify(input.gates) || value.description !== input.description) return false;
      return input.previousPolicyRef === undefined || (isObject(input.previousPolicyRef) && isObject(value.policyRef) &&
        value.policyRef.entityId === input.previousPolicyRef.entityId &&
        value.policyRef.version === Number(input.previousPolicyRef.version) + 1);
    case 'M-030':
      return requestScope?.kind === 'sr' && isObject(input) && isGate(input.gate) &&
        isReviewAssignmentView(value, requestScope, input.gate) && isObject(value) &&
        JSON.stringify(value.reviewerIds) === JSON.stringify(input.reviewerIds);
    case 'M-031':
      return requestScope?.kind === 'sr' && isPolicyApplicationResult(value, requestScope, input);
    case 'M-045':
      return isObject(value) && isString(value.projectId) && Array.isArray(value.cards) &&
        value.cards.every((card) => isObject(card) && isSrView(card.sr) &&
          isString(card.reviewStatus) && isStringArray(card.blockers) && isStringArray(card.nextActions)) &&
        typeof value.truncated === 'boolean' && isNumber(value.revision);
    case 'M-047':
      if (!isObject(value) || requestScope?.kind !== 'sr') return false;
      if (!isSrView(value.sr) || !isDescriptionView(value.originalDescription) ||
        !isDescriptionView(value.currentDescription) || !Array.isArray(value.sources) ||
        !value.sources.every(isContextSourceView) || !Array.isArray(value.artifacts) ||
        !value.artifacts.every(isArtifactView) ||
        !Array.isArray(value.questions) || !value.questions.every(isQuestionView) ||
        !Array.isArray(value.decisions) || !value.decisions.every(isDecisionView) || !Array.isArray(value.bundles) ||
        !value.bundles.every((bundle) => isObject(bundle) && isBundleRef(bundle.bundleRef) && isNumber(bundle.reviewEpoch)) ||
        !Array.isArray(value.generationRuns) || !Array.isArray(value.generationDrafts) ||
        !value.generationDrafts.every(isGenerationDraftIndex) ||
        (value.draftReview !== undefined && (!isObject(value.draftReview) ||
          !isDraftView(value.draftReview.draft) || !isInputSnapshot(value.draftReview.inputSnapshot))) ||
        (value.preparation !== undefined && !isGenerationPreparation(value.preparation)) ||
        (value.preparationUnavailable !== undefined && (!isObject(value.preparationUnavailable) ||
          !isString(value.preparationUnavailable.reason))) ||
        !Array.isArray(value.implementations) || !isNumber(value.revision) ||
        !matchesSrScope(value.sr, requestScope) ||
        !value.questions.every((question) => matchesSrScope(question, requestScope)) ||
        !value.decisions.every((decision) => matchesSrScope(decision, requestScope)) ||
        !hasConsistentQuestionDecisionLinks(value)) return false;
      if (!Array.isArray(value.reviewConfigurations) || value.reviewConfigurations.length !== 2 ||
        !value.reviewConfigurations.every((item) => isReviewConfiguration(item, requestScope)) ||
        new Set(value.reviewConfigurations.map((item) => isObject(item) ? item.gate : undefined)).size !== 2 ||
        !Array.isArray(value.reviewPreparations) || value.reviewPreparations.length !== 2 ||
        !value.reviewPreparations.every((item) => isReviewPreparation(item, requestScope)) ||
        new Set(value.reviewPreparations.map((item) => isObject(item) ? item.gate : undefined)).size !== 2 ||
        !Array.isArray(value.comments) || !value.comments.every((item) => isCommentView(item, requestScope)) ||
        !Array.isArray(value.changeRequests) || !value.changeRequests.every((item) => isChangeRequestView(item, requestScope)) ||
        !Array.isArray(value.reviewRequests) || !value.reviewRequests.every((item) => isReviewRequestView(item, requestScope)) ||
        !Array.isArray(value.approvals) || !value.approvals.every((item) => isApprovalView(item, requestScope)) ||
        !Array.isArray(value.gateAssessments) || value.gateAssessments.length !== 2 ||
        !value.gateAssessments.every((item) => isGateAssessment(item, requestScope)) ||
        new Set(value.gateAssessments.map((item) => isObject(item) ? item.gate : undefined)).size !== 2) return false;
      const configurations = value.reviewConfigurations as unknown[];
      const preparations = value.reviewPreparations as unknown[];
      return preparations.every((preparation) => {
        if (!isObject(preparation) || !isGate(preparation.gate)) return false;
        const configuration = configurations.find((item) =>
          isObject(item) && item.gate === preparation.gate);
        return isObject(configuration) && preparation.gateRevision === configuration.revision;
      });
    default:
      return true;
  }
}

function decodeBase64UrlJson(value: string): unknown {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function scopeOf(scope: { readonly projectId: string; readonly srId?: string }): TargetScope {
  return scope.srId === undefined
    ? { kind: 'project', projectId: scope.projectId }
    : { kind: 'sr', projectId: scope.projectId, srId: scope.srId };
}

function markdownDownload(response: Response, handoffId: string): Promise<MarkdownDownload> {
  const contentType = response.headers.get('content-type');
  if (contentType !== 'text/markdown; charset=utf-8') {
    throw new Error('Markdown Content-Type이 올바르지 않습니다.');
  }
  const disposition = response.headers.get('content-disposition');
  const encodedName = /^attachment; filename\*=UTF-8''(.+)$/u.exec(disposition ?? '')?.[1];
  if (encodedName === undefined) throw new Error('다운로드 파일 이름이 없습니다.');
  return response.arrayBuffer().then((buffer) => ({
    handoffId,
    filename: decodeURIComponent(encodedName),
    contentType,
    bytes: new Uint8Array(buffer),
  }));
}

export async function invoke<M extends PublicMethodId>(
  method: M,
  scope: BrowserInvokeScope<M>,
  input: MethodInput<M>,
): Promise<BrowserInvokeResult<MethodValue<M>>> {
  const definition = METHOD_DEFINITIONS[method];
  const requestScope = scopeOf(scope);
  const body = definition.mode === 'query'
    ? { scope: requestScope, input }
    : {
        scope: requestScope,
        input,
        meta: {
          requestId: scope.requestId ?? crypto.randomUUID(),
          idempotencyKey: scope.idempotencyKey ?? crypto.randomUUID(),
          ...(scope.guard === undefined ? {} : { guard: scope.guard }),
        },
      };
  let response: Response;
  try {
    response = await fetch(`/api/methods/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(method === 'M-002' || scope.actorId === undefined
          ? {}
          : { 'x-planrepo-actor': scope.actorId }),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (definition.mode === 'command') throw new TransportUncertainError(error);
    throw error;
  }

  if (method === 'M-042' && response.ok) {
    try {
      const metadataHeader = response.headers.get('x-planrepo-command');
      if (metadataHeader === null) throw new Error('명령 결과 metadata가 없습니다.');
      const metadata = decodeBase64UrlJson(metadataHeader) as {
        kind: 'Committed' | 'Replayed'; receipt: CommandReceipt; current?: CurrentBasis;
      };
      if (
        (metadata.kind !== 'Committed' && metadata.kind !== 'Replayed') ||
        !isObject(metadata.receipt) ||
        (metadata.kind === 'Replayed' && !isObject(metadata.current))
      ) throw new Error('명령 결과 metadata가 올바르지 않습니다.');
      const value = await markdownDownload(response, input as string);
      return {
        ok: true,
        value: value as MethodValue<M>,
        disposition: metadata.kind,
        receipt: metadata.receipt,
        ...(metadata.current === undefined ? {} : { current: metadata.current }),
      };
    } catch (error) {
      throw new TransportUncertainError(error);
    }
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    if (response.ok && definition.mode === 'command') {
      throw new TransportUncertainError(error);
    }
    raw = undefined;
  }
  if (!response.ok) {
    const envelope = isObject(raw) ? raw : {};
    const error = isObject(envelope.error)
      ? envelope.error as unknown as DomainError
      : fallbackError(raw);
    return {
      ok: false,
      error,
      ...(isObject(envelope.priorReceipt)
        ? { priorReceipt: envelope.priorReceipt as unknown as CommandReceipt }
        : {}),
    };
  }
  if (definition.mode === 'query') {
    if (!isMethodValue(method, raw, requestScope, input)) throw new Error(`${method} 응답 value가 올바르지 않습니다.`);
    return { ok: true, value: raw as MethodValue<M>, disposition: 'Query' };
  }
  if (
    !isObject(raw) ||
    (raw.kind !== 'Committed' && raw.kind !== 'Replayed') ||
    !('value' in raw) ||
    !isMethodValue(method, raw.value, requestScope, input) ||
    !isCommandReceipt(raw.receipt) ||
    (raw.kind === 'Replayed' && !isCurrentBasis(raw.current))
  ) {
    throw new TransportUncertainError(new Error('명령 응답 envelope가 올바르지 않습니다.'));
  }
  const command = raw as unknown as {
    readonly kind: 'Committed' | 'Replayed';
    readonly value: MethodValue<M>;
    readonly receipt: CommandReceipt;
    readonly current?: CurrentBasis;
  };
  return {
    ok: true,
    value: command.value,
    disposition: command.kind,
    receipt: command.receipt,
    ...(command.current === undefined ? {} : { current: command.current }),
  };
}

export function asCommandResult<T>(result: BrowserInvokeResult<T>): CommandResult<T> {
  if (!result.ok) {
    return {
      kind: 'Rejected',
      error: result.error,
      ...(result.priorReceipt === undefined ? {} : { priorReceipt: result.priorReceipt }),
    };
  }
  if (result.disposition === 'Committed' && result.receipt !== undefined) {
    return { kind: 'Committed', value: result.value, receipt: result.receipt };
  }
  if (
    result.disposition === 'Replayed' &&
    result.receipt !== undefined &&
    result.current !== undefined
  ) {
    return {
      kind: 'Replayed',
      value: result.value,
      receipt: result.receipt,
      current: result.current,
    };
  }
  throw new Error('명령 응답 envelope가 올바르지 않습니다.');
}
