import type { DatabaseConnection } from '@/src/persistence/database';
import type { BundleRef, GateKind, SrScope } from '@/src/contracts/context';
import type {
  PolicyView, ReviewAssignmentView, ReviewBundleSnapshot, ReviewBundleView, ReviewPreparationView,
  ReviewRequestInput,
  UnconfirmedDecisionSnapshot,
} from '@/src/contracts/views';
import { readCurrentArtifacts } from '@/src/persistence/artifact-repository';
import { readContextSources } from '@/src/persistence/context-source-repository';
import { readDecisionViews, readQuestionViews } from '@/src/persistence/question-decision-repository';
import { readMembership, readSrView } from '@/src/persistence/sr-repository';
import { insertReviewBundle, readGateState } from '@/src/persistence/review-policy-repository';
import { assessReviewerAssignment } from '@/src/domain/review-policy';

export interface ReviewBundleCaptureInput {
  readonly scope: SrScope;
  readonly gate: GateKind;
  readonly actorId: string;
  readonly assignment: ReviewAssignmentView;
  readonly policy: PolicyView;
  readonly createdAt: string;
}

export type PreparedReviewBundle =
  | Extract<ReviewBundleView, { readonly kind: 'NeedsInputs' }>
  | {
      readonly kind: 'Prepared';
      readonly snapshot: Omit<ReviewBundleSnapshot, 'bundleRef'>;
    };

export function assessCurrentReviewAssignment(
  db: DatabaseConnection,
  input: Pick<ReviewBundleCaptureInput, 'scope' | 'gate' | 'assignment' | 'policy'>,
): ReviewAssignmentView {
  const sr = readSrView(db, input.scope.projectId, input.scope.srId);
  if (sr === undefined) throw new Error('검토자 배정 대상 SR을 찾을 수 없습니다.');
  const memberships = input.assignment.reviewerIds
    .map((reviewerId) => readMembership(db, input.scope.projectId, reviewerId))
    .filter((membership): membership is NonNullable<typeof membership> => membership !== undefined);
  const readiness = assessReviewerAssignment(
    input.assignment.reviewerIds,
    sr.ownerId,
    memberships,
    input.policy.gates[input.gate],
  );
  return {
    ...input.assignment,
    ready: readiness.ready,
    ...(readiness.reason === undefined ? {} : { notReadyReason: readiness.reason }),
  };
}

export function reviewPreparationFromPrepared(
  gate: GateKind,
  gateRevision: number,
  prepared: PreparedReviewBundle,
): ReviewPreparationView {
  if (prepared.kind === 'NeedsInputs') {
    return {
      kind: 'NeedsInputs',
      gate,
      gateRevision,
      missing: prepared.missing,
      assigneeIds: prepared.assigneeIds,
    };
  }
  const snapshot = prepared.snapshot;
  const base = {
    artifactVersionRefs: snapshot.artifactVersionRefs,
    decisionVersionRefs: snapshot.decisionVersionRefs,
    unconfirmedDecisionSnapshots: snapshot.unconfirmedDecisionSnapshots,
    questionResultRefs: snapshot.questionResultRefs,
    classificationRefs: snapshot.classificationRefs,
    contextSourceVersionRefs: snapshot.contextSourceVersionRefs,
    assignmentRef: snapshot.assignmentRef,
    reviewerIds: snapshot.reviewerIds,
    policyRef: snapshot.policyRef,
  };
  const request: ReviewRequestInput = gate === 'G1'
    ? { gate: 'G1', ...base }
    : { gate: 'G2', ...base, g1BundleRef: snapshot.g1BundleRef! };
  return {
    kind: 'Ready',
    gate,
    gateRevision,
    input: request,
    checklistSnapshot: snapshot.checklistSnapshot,
  };
}

export function prepareCurrentReviewBundle(
  db: DatabaseConnection,
  input: ReviewBundleCaptureInput,
): PreparedReviewBundle {
  const state = readGateState(db, input.scope, input.gate);
  const sr = readSrView(db, input.scope.projectId, input.scope.srId);
  if (state === undefined || sr === undefined) throw new Error('검토 묶음 대상 SR 또는 gate를 찾을 수 없습니다.');
  const missing: string[] = [];
  const assigneeIds = new Set<string>();
  const currentAssignment = assessCurrentReviewAssignment(db, input);
  if (!currentAssignment.ready) {
    missing.push(currentAssignment.notReadyReason ?? '검토자 배정이 준비되지 않았습니다.');
    currentAssignment.reviewerIds.forEach((id) => assigneeIds.add(id));
  }
  const artifacts = readCurrentArtifacts(db, input.scope.projectId, input.scope.srId);
  const requiredKinds = input.gate === 'G1'
    ? ['requirements'] as const
    : ['requirements', 'workflow_plan', 'implementation_plan'] as const;
  for (const kind of requiredKinds) {
    if (!artifacts.some((artifact) => artifact.kind === kind)) {
      missing.push(`${kind} 문서가 필요합니다.`);
      assigneeIds.add(sr.ownerId);
    }
  }
  const workflow = artifacts.find((artifact) => artifact.kind === 'workflow_plan');
  const selectedDesignRefs = input.gate === 'G2'
    ? workflow?.workflow?.stages.flatMap((stage) => stage.choice === 'executed' ? stage.designArtifactRefs : []) ?? []
    : [];
  if (input.gate === 'G2' && selectedDesignRefs.length === 0) {
    missing.push('선택된 설계 문서가 필요합니다.');
    assigneeIds.add(sr.ownerId);
  }
  const selectedArtifacts = input.gate === 'G1'
    ? artifacts.filter((artifact) => artifact.kind === 'requirements')
    : artifacts.filter((artifact) =>
      artifact.kind === 'requirements' || artifact.kind === 'workflow_plan' || artifact.kind === 'implementation_plan' ||
      selectedDesignRefs.some((ref) => ref.entityId === artifact.artifactId && ref.version === artifact.versionRef.version));
  if (selectedDesignRefs.some((ref) => !selectedArtifacts.some((artifact) => artifact.versionRef.entityId === ref.entityId && artifact.versionRef.version === ref.version))) {
    missing.push('진행 계획이 선택한 현재 설계 문서를 찾을 수 없습니다.');
    assigneeIds.add(sr.ownerId);
  }
  let g1BundleRef: BundleRef<'G1'> | undefined;
  if (input.gate === 'G2') {
    const g1 = readGateState(db, input.scope, 'G1');
    if (g1?.validity !== 'valid' || g1.needsNewBundle || g1.currentBundleRef?.gate !== 'G1') {
      missing.push('현재 유효한 G1 통과 묶음이 필요합니다.');
      assigneeIds.add(sr.ownerId);
    } else {
      g1BundleRef = g1.currentBundleRef as BundleRef<'G1'>;
    }
  }
  if (missing.length > 0) {
    return { kind: 'NeedsInputs', gate: input.gate, missing, assigneeIds: [...assigneeIds] };
  }

  const questions = readQuestionViews(db, input.scope.projectId, input.scope.srId)
    .filter((question) => question.currentClassification.scope === 'current' && question.currentClassification.requiredGate === input.gate);
  const decisions = readDecisionViews(db, input.scope.projectId, input.scope.srId)
    .filter((decision) => decision.currentClassification.scope === 'current' && decision.currentClassification.requiredGate === input.gate);
  const decisionVersionRefs = decisions.flatMap((decision) =>
    decision.currentConfirmation === undefined ? [] : [decision.currentConfirmation.ref]);
  const unconfirmedDecisionSnapshots = decisions.flatMap((decision): readonly UnconfirmedDecisionSnapshot[] =>
    decision.currentConfirmation !== undefined ? [] : [{
      decisionId: decision.decisionId,
      revision: decision.revision,
      prompt: decision.prompt,
      alternatives: decision.alternatives as UnconfirmedDecisionSnapshot['alternatives'],
      impact: decision.impact,
      decisionMakerId: decision.decisionMakerId,
      classificationRef: decision.classificationRef,
    }]);
  const snapshot: Omit<ReviewBundleSnapshot, 'bundleRef'> = {
    reviewEpoch: state.reviewEpoch,
    artifactVersionRefs: selectedArtifacts.map((artifact) => artifact.versionRef),
    decisionVersionRefs,
    unconfirmedDecisionSnapshots,
    questionResultRefs: questions.map((question) => question.currentResult.ref),
    classificationRefs: [
      ...questions.map((question) => question.classificationRef),
      ...decisions.map((decision) => decision.classificationRef),
    ],
    contextSourceVersionRefs: readContextSources(db, input.scope.projectId, input.scope.srId)
      .map((source) => source.currentVersionRef),
    assignmentRef: currentAssignment.assignmentRef,
    reviewerIds: [...currentAssignment.reviewerIds],
    policyRef: input.policy.policyRef,
    checklistSnapshot: input.policy.gates[input.gate].checklist,
    descriptionRef: sr.currentDescriptionRef,
    createdBy: input.actorId,
    createdAt: input.createdAt,
    ...(state.currentBundleRef === undefined ? {} : { previousBundleRef: state.currentBundleRef }),
    ...(g1BundleRef === undefined ? {} : { g1BundleRef }),
  };
  return { kind: 'Prepared', snapshot };
}

export function persistPreparedReviewBundle(
  db: DatabaseConnection,
  input: ReviewBundleCaptureInput,
  prepared: Extract<PreparedReviewBundle, { readonly kind: 'Prepared' }>,
  options: { readonly advanceGateRevision?: boolean } = {},
): Extract<ReviewBundleView, { readonly kind: 'BundleAvailable' }> {
  const stored = insertReviewBundle(db, {
    snapshot: prepared.snapshot,
    scope: input.scope,
    gate: input.gate,
    ...(options.advanceGateRevision === undefined ? {} : { advanceGateRevision: options.advanceGateRevision }),
  });
  return { kind: 'BundleAvailable', bundle: stored.snapshot, requestIds: stored.requestIds };
}

export function captureCurrentReviewBundle(
  db: DatabaseConnection,
  input: ReviewBundleCaptureInput,
): ReviewBundleView {
  const prepared = prepareCurrentReviewBundle(db, input);
  return prepared.kind === 'NeedsInputs'
    ? prepared
    : persistPreparedReviewBundle(db, input, prepared);
}
