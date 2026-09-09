import { PUBLIC_METHOD_IDS, type PublicMethodId } from './methods';
import { SOURCE_LINK_URL_PATTERN } from '@/src/domain/source-url';

export const METHOD_REQUEST_MAX_BYTES = 8 * 1024 * 1024;
export const ARTIFACT_MARKDOWN_MAX_BYTES = 1024 * 1024;
export const ARTIFACT_MARKDOWN_MAX_CHARACTERS = 1024 * 1024;
export const GENERATION_EXPLICIT_INPUT_MAX_BYTES = 2 * 1024 * 1024;

export type JsonSchemaScalar = string | number | boolean | null;
export type JsonSchemaValue = JsonSchemaScalar | readonly JsonSchemaValue[] | { readonly [key: string]: JsonSchemaValue };
export interface JsonSchema { readonly [key: string]: JsonSchemaValue }

const ID_MAX = 256;
const SHORT_MAX = 4_096;
const LONG_MAX = 65_536;
const MANY = 1_000;
const str = (maxLength = SHORT_MAX): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const maybeStr = (maxLength = SHORT_MAX): JsonSchema => ({ type: 'string', maxLength });
const id = str(ID_MAX);
const rev: JsonSchema = { type: 'integer', minimum: 0 };
const bool: JsonSchema = { type: 'boolean' };
const enums = (...values: readonly string[]): JsonSchema => ({ type: 'string', enum: values });
const arr = (items: JsonSchema, minItems = 0, maxItems = MANY): JsonSchema => ({ type: 'array', items, minItems, maxItems });
const obj = (properties: Readonly<Record<string, JsonSchema>>, required: readonly string[] = Object.keys(properties)): JsonSchema => ({
  type: 'object', additionalProperties: false, properties, required,
});
const one = (...variants: readonly JsonSchema[]): JsonSchema => ({ oneOf: variants });

const none = obj({});
const projectScope = obj({ kind: { const: 'project' }, projectId: id });
const srScope = obj({ kind: { const: 'sr' }, projectId: id, srId: id });
const targetScope = one(projectScope, srScope);
const srVersionRef = obj({
  kind: enums('sr_description', 'context_source', 'artifact', 'question_answer', 'question_result', 'decision', 'scope_classification', 'review_assignment', 'handoff'),
  projectId: id, srId: id, entityId: id, version: rev,
});
const typedSrRef = (kind: string): JsonSchema => obj({ kind: { const: kind }, projectId: id, srId: id, entityId: id, version: rev });
const artifactRef = typedSrRef('artifact');
const questionResultRef = typedSrRef('question_result');
const questionAnswerRef = typedSrRef('question_answer');
const decisionRef = typedSrRef('decision');
const classificationRef = typedSrRef('scope_classification');
const sourceRef = typedSrRef('context_source');
const assignmentRef = typedSrRef('review_assignment');
const policyRef = obj({ kind: { const: 'review_policy' }, projectId: id, entityId: id, version: rev });
const versionRef = one(srVersionRef, policyRef);
const bundleRef = obj({ projectId: id, srId: id, gate: enums('G1', 'G2'), bundleId: id, version: rev });
const g1BundleRef = obj({ projectId: id, srId: id, gate: { const: 'G1' }, bundleId: id, version: rev });
const g2BundleRef = obj({ projectId: id, srId: id, gate: { const: 'G2' }, bundleId: id, version: rev });
const srEntity = (...kinds: readonly string[]): JsonSchema => obj({
  kind: enums(...kinds), projectId: id, srId: id, entityId: id,
});
const projectEntity = obj({ kind: enums('project', 'review_policy'), projectId: id, entityId: id });
const activityEntity = obj({ kind: { const: 'activity' }, projectId: id, srId: id, entityId: id }, ['kind', 'projectId', 'entityId']);
const allSrEntity = srEntity('sr', 'sr_description', 'context_source', 'artifact', 'question', 'question_answer', 'question_result', 'decision', 'scope_classification', 'review_assignment', 'review_bundle', 'review_gate_state', 'review_request', 'approval', 'comment', 'change_request', 'change_request_event', 'input_snapshot', 'generation_run', 'generation_draft', 'draft_application', 'handoff', 'implementation');
const entityRef = one(projectEntity, allSrEntity, activityEntity);
const evidenceRef = one(versionRef, obj({ kind: { const: 'external' }, label: str(), url: str(LONG_MAX), verificationSummary: str(LONG_MAX) }, ['kind', 'label', 'verificationSummary']));
const evidence = one(obj({ refs: arr(evidenceRef, 1) }), obj({ text: str(LONG_MAX) }));

const revisionExpectation = (target: JsonSchema): JsonSchema => obj({ target, expectedRevision: rev });
const absentExpectation = obj({
  target: obj({ kind: { const: 'artifact_logical_key' }, projectId: id, srId: id, logicalKey: id }),
  expected: { const: 'absent' },
});
const revisionGuard = (kind: string): JsonSchema => obj({ resource: revisionExpectation(srEntity(kind)) });
const revisionGuardFor = (...kinds: readonly string[]): JsonSchema => obj({ resource: revisionExpectation(srEntity(...kinds)) });
const policyApplicationGuard = obj({ resources: arr(revisionExpectation(srEntity('review_gate_state')), 1, 2) });
const revisionOrAbsentGuard = obj({ resource: one(revisionExpectation(srEntity('artifact')), absentExpectation) });
const bundleGuard = obj({ expectedBundleRef: bundleRef, expectedReviewEpoch: rev });
const g2BundleGuard = obj({ expectedBundleRef: g2BundleRef, expectedReviewEpoch: rev });
const fingerprintGuard = obj({ expectedInputFingerprint: str(512) });
const proposalDraftGuard = (kind: 'questions' | 'decisions'): JsonSchema => obj({ kind: { const: kind }, expectedInputFingerprint: str(512) });
const artifactDraftGuard = obj({ kind: { const: 'artifact' }, expectedInputFingerprint: str(512), target: one(revisionExpectation(srEntity('artifact')), absentExpectation) });
const revisionBundleGuard = (kind: string, exactBundle: JsonSchema = bundleRef): JsonSchema => obj({ resource: revisionExpectation(srEntity(kind)), expectedBundleRef: exactBundle, expectedReviewEpoch: rev });
const transitionGuard = one(revisionGuard('sr'), revisionBundleGuard('sr'));

const query = (scope: JsonSchema, input: JsonSchema): JsonSchema => obj({ scope, input });
const meta = (guard?: JsonSchema): JsonSchema => obj(
  { requestId: id, idempotencyKey: id, ...(guard === undefined ? {} : { guard }) },
  guard === undefined ? ['requestId', 'idempotencyKey'] : ['requestId', 'idempotencyKey', 'guard'],
);
const command = (scope: JsonSchema, input: JsonSchema, guard?: JsonSchema): JsonSchema => obj({ scope, input, meta: meta(guard) });

const newSr = obj({ key: id, title: str(), purpose: str(LONG_MAX), description: str(ARTIFACT_MARKDOWN_MAX_CHARACTERS), ownerId: id, existingSystem: bool }, ['key', 'title', 'purpose', 'description', 'ownerId']);
const descriptionEdit = obj({ title: str(), purpose: str(LONG_MAX), description: str(ARTIFACT_MARKDOWN_MAX_CHARACTERS), changeReason: str(LONG_MAX) });
const sourceInput = one(
  obj({ kind: enums('text', 'markdown'), content: str(ARTIFACT_MARKDOWN_MAX_CHARACTERS), provenance: str(LONG_MAX), displayName: str() }, ['kind', 'content', 'provenance']),
  obj({ kind: { const: 'link' }, targetUrl: { ...str(LONG_MAX), pattern: SOURCE_LINK_URL_PATTERN }, provenance: str(LONG_MAX), verifiable: bool, displayName: str(), observedExternalVersion: str(), unavailableReason: str(LONG_MAX) }, ['kind', 'targetUrl', 'provenance', 'verifiable']),
);
const sourceConfirmation = obj({ sourceVersionRef: sourceRef, confirmationEvidence: str(LONG_MAX) });
const answerValue = one(obj({ kind: { const: 'choice' }, optionId: id, text: str(LONG_MAX) }), obj({ kind: { const: 'free_text' }, text: str(LONG_MAX) }));
const questionAnswer = obj({ questionId: id, answeredQuestionSnapshotRef: questionResultRef, answer: answerValue, evidence });
const questionResolution = obj({
  questionId: id, selectedAnswerRef: questionAnswerRef, resolutionEvidence: evidence,
  documentDisposition: one(obj({ kind: { const: 'reflected' }, artifactVersionRefs: arr(artifactRef, 1) }), obj({ kind: { const: 'not_required' }, reason: str(LONG_MAX) })),
});
const choice = obj({ optionId: id, text: str(LONG_MAX) });
const classInput = one(
  obj({ scope: { const: 'current' }, requiredGate: enums('G1', 'G2'), reason: str(LONG_MAX) }),
  obj({
    scope: { const: 'followup' },
    requiredGate: { const: 'None' },
    reason: str(LONG_MAX),
    ownerId: id,
    revisit: one(
      obj({ kind: { const: 'at' }, at: str(128) }),
      obj({ kind: { const: 'event' }, event: str(LONG_MAX) }),
    ),
  }),
);
const followup = one(
  obj({ parentQuestionId: id, text: str(LONG_MAX), reason: str(LONG_MAX), assigneeId: id, answerMode: { const: 'choice' }, classification: classInput, options: arr(choice, 1), candidateAnswers: arr(str(LONG_MAX)), relatedArtifactRefs: arr(artifactRef), sourceRefs: arr(sourceRef), dueAt: str(128) }, ['parentQuestionId', 'text', 'reason', 'assigneeId', 'answerMode', 'classification', 'options']),
  obj({ parentQuestionId: id, text: str(LONG_MAX), reason: str(LONG_MAX), assigneeId: id, answerMode: { const: 'free_text' }, classification: classInput, candidateAnswers: arr(str(LONG_MAX)), relatedArtifactRefs: arr(artifactRef), sourceRefs: arr(sourceRef), dueAt: str(128) }, ['parentQuestionId', 'text', 'reason', 'assigneeId', 'answerMode', 'classification']),
);
const alternative = obj({ optionId: id, label: str(), description: str(LONG_MAX) });
const decisionConversion = obj({ questionId: id, questionResultSnapshotRef: questionResultRef, prompt: str(LONG_MAX), alternatives: arr(alternative, 1), impact: str(LONG_MAX), decisionMakerId: id, classificationRef });
const selection = obj({ optionId: id, text: str(LONG_MAX) }, ['text']);
const decisionConfirmation = obj({ decisionId: id, selection, rationale: str(LONG_MAX), evidence });
const decisionRevision = obj({ decisionId: id, selection, rationale: str(LONG_MAX), evidence, previousVersionRef: decisionRef, changeReason: str(LONG_MAX) });
const classification = one(
  obj({ targetRef: srEntity('question', 'decision'), scope: { const: 'current' }, requiredGate: enums('G1', 'G2'), reason: str(LONG_MAX), basisRefs: arr(versionRef) }, ['targetRef', 'scope', 'requiredGate', 'reason']),
  obj({ targetRef: srEntity('question', 'decision'), scope: { const: 'followup' }, requiredGate: { const: 'None' }, reason: str(LONG_MAX), ownerId: id, revisit: one(obj({ kind: { const: 'at' }, at: str(128) }), obj({ kind: { const: 'event' }, event: str(LONG_MAX) })), basisRefs: arr(versionRef) }, ['targetRef', 'scope', 'requiredGate', 'reason', 'ownerId', 'revisit']),
);
const section = obj({ sectionId: id, title: str(), startOffset: rev, endOffset: rev });
const requirementLink = obj({ requirementId: id, sectionIds: arr(id, 1), acceptanceCriteria: arr(str(LONG_MAX)) });
const absentTarget = obj({ kind: { const: 'absent' }, logicalKey: id });
const versionTarget = obj({ kind: { const: 'version' }, ref: artifactRef });
const artifactTarget = one(absentTarget, versionTarget);
const artifactFields: Readonly<Record<string, JsonSchema>> = {
  artifactId: id, markdown: maybeStr(ARTIFACT_MARKDOWN_MAX_CHARACTERS), sectionIndex: arr(section), requirementLinks: arr(requirementLink), changeSummary: str(LONG_MAX), targetBasis: artifactTarget,
  decisionRefs: arr(decisionRef), sourceRefs: arr(sourceRef), questionResultRefs: arr(questionResultRef),
};
const artifactRequired = ['kind', 'markdown', 'sectionIndex', 'requirementLinks', 'changeSummary', 'targetBasis'];
const artifactEdit = one(
  obj({ kind: enums('requirements', 'workflow_plan', 'implementation_plan'), ...artifactFields }, artifactRequired),
  obj({ kind: { const: 'design' }, ...artifactFields, designStage: enums('application', 'functional', 'nfr', 'infrastructure') }, [...artifactRequired, 'designStage']),
);
const artifactPair = obj({ before: artifactRef, after: artifactRef });
const workflowStage = one(obj({ stageId: id, choice: { const: 'executed' }, designArtifactRefs: arr(artifactRef) }), obj({ stageId: id, choice: { const: 'skipped' }, reason: str(LONG_MAX) }));
const requirementTask = obj({ taskId: id, requirementIds: arr(id, 1), verification: arr(str(LONG_MAX), 1), order: rev });
const workflowPlan = obj({ kind: { const: 'workflow_plan' }, ...artifactFields, workflowVersion: { const: 'v1.0.1' }, stages: arr(workflowStage, 1), implementationUnitCount: { const: 1 }, requirementTaskLinks: arr(requirementTask, 1) }, [...artifactRequired, 'workflowVersion', 'stages', 'implementationUnitCount', 'requirementTaskLinks']);
const draftArtifactEdit = one(
  obj({ kind: enums('requirements', 'implementation_plan'), ...artifactFields }, artifactRequired),
  obj({ kind: { const: 'design' }, ...artifactFields, designStage: enums('application', 'functional', 'nfr', 'infrastructure') }, [...artifactRequired, 'designStage']),
  workflowPlan,
);
const artifactDraftApplication = obj({ draftId: id, selectedContent: obj({ kind: { const: 'artifact' }, edit: draftArtifactEdit }), applicationReason: str(LONG_MAX) }, ['draftId', 'selectedContent']);
const questionDraftApplication = obj({ draftId: id, selectedContent: obj({ kind: { const: 'questions' }, temporaryIds: arr(id, 1) }), applicationReason: str(LONG_MAX) }, ['draftId', 'selectedContent']);
const decisionDraftSelection = obj({ temporaryId: id, decisionMakerId: id, classification: classInput });
const decisionDraftApplication = obj({ draftId: id, selectedContent: obj({ kind: { const: 'decisions' }, selections: arr(decisionDraftSelection, 1) }), applicationReason: str(LONG_MAX) }, ['draftId', 'selectedContent']);
const questionProposal = obj({
  temporaryId: id,
  text: str(LONG_MAX),
  reason: str(LONG_MAX),
  suggestedAssigneeId: id,
  requiredGate: enums('G1', 'G2'),
  sourceRefs: arr(versionRef),
  candidateAnswers: arr(str(LONG_MAX)),
});
const decisionProposal = obj({
  temporaryId: id,
  prompt: str(LONG_MAX),
  alternatives: arr(alternative, 1),
  impact: str(LONG_MAX),
  recommendation: str(LONG_MAX),
  sourceRefs: arr(versionRef),
});
const generationResult = one(
  obj({ schemaVersion: { const: 1 }, kind: { const: 'question_proposals' }, proposals: arr(questionProposal, 1) }),
  obj({ schemaVersion: { const: 1 }, kind: { const: 'decision_proposals' }, proposals: arr(decisionProposal, 1) }),
  obj({ schemaVersion: { const: 1 }, kind: { const: 'artifact' }, documentKind: enums('requirements', 'workflow_plan', 'design', 'implementation_plan'), markdown: maybeStr(2 * 1024 * 1024), requirementRefs: arr(id), changeSummary: str(LONG_MAX) }),
);
const reviewedDraft = obj({ sourceDraftId: id, currentInputFingerprint: str(512), body: generationResult, comparisonSummary: str(LONG_MAX) });
const unconfirmedDecision = obj({ decisionId: id, revision: rev, prompt: str(LONG_MAX), alternatives: arr(alternative, 1), impact: str(LONG_MAX), decisionMakerId: id, classificationRef });
const reviewFields: Readonly<Record<string, JsonSchema>> = {
  artifactVersionRefs: arr(artifactRef), decisionVersionRefs: arr(decisionRef), unconfirmedDecisionSnapshots: arr(unconfirmedDecision), questionResultRefs: arr(questionResultRef), classificationRefs: arr(classificationRef), contextSourceVersionRefs: arr(sourceRef), assignmentRef, reviewerIds: arr(id), policyRef,
};
const reviewRequired = ['gate', 'artifactVersionRefs', 'decisionVersionRefs', 'unconfirmedDecisionSnapshots', 'questionResultRefs', 'classificationRefs', 'contextSourceVersionRefs', 'assignmentRef', 'reviewerIds', 'policyRef'];
const reviewRequest = one(obj({ gate: { const: 'G1' }, ...reviewFields }, reviewRequired), obj({ gate: { const: 'G2' }, ...reviewFields, g1BundleRef }, [...reviewRequired, 'g1BundleRef']));
const approval = obj({ bundleRef, reviewEpoch: rev, checklistResults: arr(obj({ itemId: id, checked: { const: true } }), 1), approvalScope: enums('G1', 'G2'), comment: str(LONG_MAX) }, ['bundleRef', 'reviewEpoch', 'checklistResults', 'approvalScope']);
const comment = obj({ artifactVersionRef: artifactRef, sectionId: id, body: str(LONG_MAX), bundleRef }, ['artifactVersionRef', 'sectionId', 'body']);
const changeRequest = obj({ bundleRef, artifactVersionRef: artifactRef, sectionId: id, body: str(LONG_MAX), blocking: bool, affectedGate: enums('G1', 'G2'), assigneeId: id, dueAt: str(128) }, ['artifactVersionRef', 'sectionId', 'body', 'blocking', 'affectedGate', 'assigneeId']);
const changeApplication = obj({ changeRequestId: id, appliedArtifactVersionRef: artifactRef, applicationSummary: str(LONG_MAX), evidence });
const changeConfirmation = obj({ changeRequestId: id, applicationEventRef: srEntity('change_request_event'), appliedArtifactVersionRef: artifactRef, result: obj({ kind: { const: 'resolved' }, verification: str(LONG_MAX) }) });
const changeFeedback = obj({ changeRequestId: id, currentApplicationEventRef: entityRef, unresolvedSummary: str(LONG_MAX), feedback: str(LONG_MAX) }, ['changeRequestId', 'unresolvedSummary', 'feedback']);
const stageTransition = obj({ toStage: enums('sr_received', 'requirements', 'planning', 'ready', 'implementing', 'completed'), reason: str(LONG_MAX), gate: enums('G1', 'G2'), bundleRef }, ['toStage', 'reason']);
const gatePolicy = obj({ requiredRoles: arr(id, 1), checklist: arr(obj({ itemId: id, label: str() }), 1) });
const policyFields = {
  description: str(LONG_MAX),
  gates: obj({ G1: gatePolicy, G2: gatePolicy }),
  requireAllAssigned: { const: true },
  requireDistinctPeer: { const: true },
} as const;
const policyEdit = one(
  obj(policyFields, ['gates', 'requireAllAssigned', 'requireDistinctPeer']),
  obj(
    { ...policyFields, previousPolicyRef: policyRef, changeReason: str(LONG_MAX) },
    ['gates', 'requireAllAssigned', 'requireDistinctPeer', 'previousPolicyRef', 'changeReason'],
  ),
);
const reviewerAssignment = one(obj({ gate: enums('G1', 'G2'), reviewerIds: arr(id) }), obj({ gate: enums('G1', 'G2'), reviewerIds: arr(id), previousAssignmentRef: assignmentRef, changeReason: str(LONG_MAX) }));
const policyApplication = obj({ policyRef, gates: arr(enums('G1', 'G2'), 1, 2) });
const generationInput = one(
  obj({ taskKind: enums('QUESTION_PROPOSALS', 'DECISION_PROPOSALS'), supplement: maybeStr(LONG_MAX) }, ['taskKind']),
  obj({ taskKind: { const: 'ARTIFACT_DRAFT' }, documentKind: enums('requirements', 'workflow_plan', 'design', 'implementation_plan'), targetBasis: absentTarget, supplement: maybeStr(LONG_MAX) }, ['taskKind', 'documentKind', 'targetBasis']),
  obj({ taskKind: { const: 'ARTIFACT_REVISION' }, documentKind: enums('requirements', 'workflow_plan', 'design', 'implementation_plan'), targetBasis: versionTarget, supplement: maybeStr(LONG_MAX) }, ['taskKind', 'documentKind', 'targetBasis']),
);
const generationPreparation = one(
  none,
  obj({ kind: { const: 'new_generation' }, input: generationInput }),
  obj({ kind: { const: 'retry' }, runId: id }),
  obj({ kind: { const: 'draft' }, draftId: id }),
);
const implementationCompletion = obj({ implementationId: id, completionSummary: str(LONG_MAX), evidence: arr(obj({ kind: enums('pr', 'verification', 'link'), label: str(), value: str(LONG_MAX) }), 1) });
const boardFilter = obj({ search: str(), stages: arr(enums('sr_received', 'requirements', 'planning', 'ready', 'implementing', 'completed')), gates: arr(enums('G1', 'G2'), 0, 2), blocked: bool, ownerIds: arr(id) }, []);
const inboxFilter = obj({ kinds: arr(enums('question', 'decision', 'review', 'change', 'confirmation')), srId: id, overdue: bool }, []);
const historyFilter = obj({ eventTypes: arr(id), actorIds: arr(id), targetRef: entityRef, from: str(128), to: str(128) }, []);

export const METHOD_REQUEST_SCHEMAS = {
  'M-001': query(projectScope, none),
  'M-002': query(projectScope, id),
  'M-003': command(projectScope, newSr),
  'M-004': command(projectScope, id),
  'M-005': command(srScope, descriptionEdit, revisionGuard('sr')),
  'M-006': command(srScope, sourceInput, revisionGuard('sr')),
  'M-007': command(srScope, sourceConfirmation, revisionGuard('context_source')),
  'M-008': command(srScope, questionAnswer, revisionGuard('question')),
  'M-009': command(srScope, questionResolution, revisionGuard('question')),
  'M-010': command(srScope, followup, revisionGuard('question')),
  'M-011': command(srScope, decisionConversion, revisionGuard('question')),
  'M-012': command(srScope, decisionConfirmation, revisionGuard('decision')),
  'M-013': command(srScope, decisionRevision, revisionGuard('decision')),
  'M-014': command(srScope, classification, revisionGuardFor('question', 'decision')),
  'M-015': command(srScope, artifactEdit, revisionOrAbsentGuard),
  'M-016': query(srScope, artifactPair),
  'M-017': command(srScope, workflowPlan, revisionOrAbsentGuard),
  'M-018': one(
    command(srScope, artifactDraftApplication, artifactDraftGuard),
    command(srScope, questionDraftApplication, proposalDraftGuard('questions')),
    command(srScope, decisionDraftApplication, proposalDraftGuard('decisions')),
  ),
  'M-019': command(srScope, reviewedDraft, fingerprintGuard),
  'M-020': command(srScope, reviewRequest, revisionGuard('review_gate_state')),
  'M-021': command(srScope, approval, bundleGuard),
  'M-022': command(srScope, comment),
  'M-023': command(srScope, changeRequest, revisionBundleGuard('review_gate_state')),
  'M-024': command(srScope, changeApplication, revisionGuard('change_request')),
  'M-025': command(srScope, changeConfirmation, revisionGuard('change_request')),
  'M-026': command(srScope, changeFeedback, revisionGuard('change_request')),
  'M-027': query(srScope, enums('G1', 'G2')),
  'M-028': command(srScope, stageTransition, transitionGuard),
  'M-029': command(projectScope, policyEdit),
  'M-030': command(srScope, reviewerAssignment, revisionGuard('review_gate_state')),
  'M-031': command(srScope, policyApplication, policyApplicationGuard),
  'M-032': command(srScope, generationInput, fingerprintGuard),
  'M-033': query(srScope, id),
  'M-034': command(srScope, id),
  'M-035': command(srScope, id, fingerprintGuard),
  'M-040': command(srScope, obj({ g2BundleRef }), g2BundleGuard),
  'M-041': query(srScope, id),
  'M-042': command(srScope, id, g2BundleGuard),
  'M-043': command(srScope, obj({ handoffId: id }), revisionBundleGuard('sr', g2BundleRef)),
  'M-044': command(srScope, implementationCompletion, revisionGuard('implementation')),
  'M-045': query(projectScope, boardFilter),
  'M-046': query(projectScope, inboxFilter),
  'M-047': query(srScope, generationPreparation),
  'M-048': query(targetScope, historyFilter),
} as const satisfies Record<PublicMethodId, JsonSchema>;

const exampleProjectScope = { kind: 'project', projectId: 'project-1' } as const;
const exampleSrScope = { kind: 'sr', projectId: 'project-1', srId: 'sr-1' } as const;
const exampleVersionRef = (kind: string, entityId: string) => ({
  kind, projectId: 'project-1', srId: 'sr-1', entityId, version: 1,
});
const exampleArtifactRef = exampleVersionRef('artifact', 'artifact-1');
const exampleQuestionResultRef = exampleVersionRef('question_result', 'question-1');
const exampleQuestionAnswerRef = exampleVersionRef('question_answer', 'answer-1');
const exampleDecisionRef = exampleVersionRef('decision', 'decision-1');
const exampleClassificationRef = exampleVersionRef('scope_classification', 'classification-1');
const exampleSourceRef = exampleVersionRef('context_source', 'source-1');
const exampleAssignmentRef = exampleVersionRef('review_assignment', 'assignment-1');
const examplePolicyRef = { kind: 'review_policy', projectId: 'project-1', entityId: 'policy-1', version: 1 } as const;
const exampleG1 = { projectId: 'project-1', srId: 'sr-1', gate: 'G1', bundleId: 'bundle-1', version: 1 } as const;
const exampleG2 = { ...exampleG1, gate: 'G2', bundleId: 'bundle-2' } as const;
const exampleEntity = (kind: string, entityId: string) => ({ kind, projectId: 'project-1', srId: 'sr-1', entityId });
const exampleRevisionGuard = (kind: string, entityId: string) => ({ resource: { target: exampleEntity(kind, entityId), expectedRevision: 1 } });
const exampleBundleGuard = (bundle: object) => ({ expectedBundleRef: bundle, expectedReviewEpoch: 1 });
const exampleMeta = (guard?: object) => ({ requestId: 'request-1', idempotencyKey: 'key-1', ...(guard === undefined ? {} : { guard }) });
const exampleQuery = (scope: object, input: JsonSchemaValue) => ({ scope, input });
const exampleCommand = (scope: object, input: JsonSchemaValue, guard?: object) => ({ scope, input, meta: exampleMeta(guard) });
const exampleArtifactFields = {
  kind: 'requirements', markdown: '# 요구사항', sectionIndex: [], requirementLinks: [],
  changeSummary: '초기 작성', targetBasis: { kind: 'absent', logicalKey: 'requirements' },
} as const;
const exampleReviewFields = {
  artifactVersionRefs: [exampleArtifactRef], decisionVersionRefs: [],
  unconfirmedDecisionSnapshots: [], questionResultRefs: [], classificationRefs: [],
  contextSourceVersionRefs: [], assignmentRef: exampleAssignmentRef,
  reviewerIds: ['reviewer-1'], policyRef: examplePolicyRef,
} as const;

export const METHOD_REQUEST_EXAMPLES = {
  'M-001': exampleQuery(exampleProjectScope, {}),
  'M-002': exampleQuery(exampleProjectScope, 'user-1'),
  'M-003': exampleCommand(exampleProjectScope, { key: 'SR-1', title: '제목', purpose: '목적', description: '설명', ownerId: 'user-1' }),
  'M-004': exampleCommand(exampleProjectScope, 'MOCK-1'),
  'M-005': exampleCommand(exampleSrScope, { title: '제목', purpose: '목적', description: '새 설명', changeReason: '변경' }, exampleRevisionGuard('sr', 'sr-1')),
  'M-006': exampleCommand(exampleSrScope, { kind: 'text', content: '근거', provenance: '사용자 입력' }, exampleRevisionGuard('sr', 'sr-1')),
  'M-007': exampleCommand(exampleSrScope, { sourceVersionRef: exampleSourceRef, confirmationEvidence: '직접 확인' }, exampleRevisionGuard('context_source', 'source-1')),
  'M-008': exampleCommand(exampleSrScope, { questionId: 'question-1', answeredQuestionSnapshotRef: exampleQuestionResultRef, answer: { kind: 'free_text', text: '답변' }, evidence: { text: '근거' } }, exampleRevisionGuard('question', 'question-1')),
  'M-009': exampleCommand(exampleSrScope, { questionId: 'question-1', selectedAnswerRef: exampleQuestionAnswerRef, resolutionEvidence: { text: '확인' }, documentDisposition: { kind: 'not_required', reason: '문서 변경 없음' } }, exampleRevisionGuard('question', 'question-1')),
  'M-010': exampleCommand(exampleSrScope, { parentQuestionId: 'question-1', text: '후속 질문', reason: '추가 확인', assigneeId: 'user-1', answerMode: 'free_text', classification: { scope: 'current', requiredGate: 'G1', reason: '필수' } }, exampleRevisionGuard('question', 'question-1')),
  'M-011': exampleCommand(exampleSrScope, { questionId: 'question-1', questionResultSnapshotRef: exampleQuestionResultRef, prompt: '선택', alternatives: [{ optionId: 'a', label: 'A', description: '대안' }], impact: '영향', decisionMakerId: 'user-1', classificationRef: exampleClassificationRef }, exampleRevisionGuard('question', 'question-1')),
  'M-012': exampleCommand(exampleSrScope, { decisionId: 'decision-1', selection: { optionId: 'a', text: 'A' }, rationale: '이유', evidence: { text: '근거' } }, exampleRevisionGuard('decision', 'decision-1')),
  'M-013': exampleCommand(exampleSrScope, { decisionId: 'decision-1', selection: { optionId: 'b', text: 'B' }, rationale: '새 이유', evidence: { text: '근거' }, previousVersionRef: exampleDecisionRef, changeReason: '재결정' }, exampleRevisionGuard('decision', 'decision-1')),
  'M-014': exampleCommand(exampleSrScope, { targetRef: exampleEntity('question', 'question-1'), scope: 'current', requiredGate: 'G1', reason: '필수' }, exampleRevisionGuard('question', 'question-1')),
  'M-015': exampleCommand(exampleSrScope, exampleArtifactFields, { resource: { target: { kind: 'artifact_logical_key', projectId: 'project-1', srId: 'sr-1', logicalKey: 'requirements' }, expected: 'absent' } }),
  'M-016': exampleQuery(exampleSrScope, { before: exampleArtifactRef, after: { ...exampleArtifactRef, version: 2 } }),
  'M-017': exampleCommand(exampleSrScope, { ...exampleArtifactFields, kind: 'workflow_plan', workflowVersion: 'v1.0.1', stages: [{ stageId: 'requirements', choice: 'executed', designArtifactRefs: [] }], implementationUnitCount: 1, requirementTaskLinks: [{ taskId: 'CG-01', requirementIds: ['FR-01'], verification: ['test'], order: 1 }] }, { resource: { target: { kind: 'artifact_logical_key', projectId: 'project-1', srId: 'sr-1', logicalKey: 'workflow' }, expected: 'absent' } }),
  'M-018': exampleCommand(exampleSrScope, { draftId: 'draft-1', selectedContent: { kind: 'artifact', edit: { ...exampleArtifactFields, kind: 'requirements' } } }, { kind: 'artifact', expectedInputFingerprint: 'sha256:input', target: { target: { kind: 'artifact_logical_key', projectId: 'project-1', srId: 'sr-1', logicalKey: 'requirements' }, expected: 'absent' } }),
  'M-019': exampleCommand(exampleSrScope, { sourceDraftId: 'draft-1', currentInputFingerprint: 'sha256:input', body: { schemaVersion: 1, kind: 'question_proposals', proposals: [{ temporaryId: 'tmp-1', text: '질문', reason: '누락 확인', suggestedAssigneeId: 'user-1', requiredGate: 'G1', sourceRefs: [], candidateAnswers: ['답변 후보'] }] }, comparisonSummary: '현재 자료와 비교' }, { expectedInputFingerprint: 'sha256:input' }),
  'M-020': exampleCommand(exampleSrScope, { gate: 'G1', ...exampleReviewFields }, exampleRevisionGuard('review_gate_state', 'G1')),
  'M-021': exampleCommand(exampleSrScope, { bundleRef: exampleG1, reviewEpoch: 1, checklistResults: [{ itemId: 'check-1', checked: true }], approvalScope: 'G1' }, exampleBundleGuard(exampleG1)),
  'M-022': exampleCommand(exampleSrScope, { artifactVersionRef: exampleArtifactRef, sectionId: 'section-1', body: '의견' }),
  'M-023': exampleCommand(exampleSrScope, { bundleRef: exampleG1, artifactVersionRef: exampleArtifactRef, sectionId: 'section-1', body: '수정 필요', blocking: true, affectedGate: 'G1', assigneeId: 'user-1' }, { ...exampleRevisionGuard('review_gate_state', 'G1'), ...exampleBundleGuard(exampleG1) }),
  'M-024': exampleCommand(exampleSrScope, { changeRequestId: 'change-1', appliedArtifactVersionRef: exampleArtifactRef, applicationSummary: '반영', evidence: { text: '검증' } }, exampleRevisionGuard('change_request', 'change-1')),
  'M-025': exampleCommand(exampleSrScope, { changeRequestId: 'change-1', applicationEventRef: exampleEntity('change_request_event', 'event-1'), appliedArtifactVersionRef: exampleArtifactRef, result: { kind: 'resolved', verification: '확인' } }, exampleRevisionGuard('change_request', 'change-1')),
  'M-026': exampleCommand(exampleSrScope, { changeRequestId: 'change-1', unresolvedSummary: '남은 문제', feedback: '추가 수정' }, exampleRevisionGuard('change_request', 'change-1')),
  'M-027': exampleQuery(exampleSrScope, 'G1'),
  'M-028': exampleCommand(exampleSrScope, { toStage: 'requirements', reason: '진행' }, exampleRevisionGuard('sr', 'sr-1')),
  'M-029': exampleCommand(exampleProjectScope, { gates: { G1: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'c1', label: '확인' }] }, G2: { requiredRoles: ['reviewer'], checklist: [{ itemId: 'c2', label: '확인' }] } }, requireAllAssigned: true, requireDistinctPeer: true }),
  'M-030': exampleCommand(exampleSrScope, { gate: 'G1', reviewerIds: ['reviewer-1'] }, exampleRevisionGuard('review_gate_state', 'G1')),
  'M-031': exampleCommand(exampleSrScope, { policyRef: examplePolicyRef, gates: ['G1'] }, { resources: [exampleRevisionGuard('review_gate_state', 'G1').resource] }),
  'M-032': exampleCommand(exampleSrScope, { taskKind: 'QUESTION_PROPOSALS', supplement: '누락 확인' }, { expectedInputFingerprint: 'sha256:input' }),
  'M-033': exampleQuery(exampleSrScope, 'run-1'),
  'M-034': exampleCommand(exampleSrScope, 'run-1'),
  'M-035': exampleCommand(exampleSrScope, 'run-1', { expectedInputFingerprint: 'sha256:input' }),
  'M-040': exampleCommand(exampleSrScope, { g2BundleRef: exampleG2 }, exampleBundleGuard(exampleG2)),
  'M-041': exampleQuery(exampleSrScope, 'handoff-1'),
  'M-042': exampleCommand(exampleSrScope, 'handoff-1', exampleBundleGuard(exampleG2)),
  'M-043': exampleCommand(exampleSrScope, { handoffId: 'handoff-1' }, { ...exampleRevisionGuard('sr', 'sr-1'), ...exampleBundleGuard(exampleG2) }),
  'M-044': exampleCommand(exampleSrScope, { implementationId: 'implementation-1', completionSummary: '완료', evidence: [{ kind: 'verification', label: '테스트', value: '통과' }] }, exampleRevisionGuard('implementation', 'implementation-1')),
  'M-045': exampleQuery(exampleProjectScope, {}),
  'M-046': exampleQuery(exampleProjectScope, {}),
  'M-047': exampleQuery(exampleSrScope, {}),
  'M-048': exampleQuery(exampleProjectScope, {}),
} as const satisfies Readonly<Record<PublicMethodId, object>>;

if (Object.keys(METHOD_REQUEST_SCHEMAS).length !== PUBLIC_METHOD_IDS.length) {
  throw new Error('public method schema registry is incomplete');
}
