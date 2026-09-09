import type {
  ArtifactVersionRef,
  BundleRef,
  ContextSourceVersionRef,
  DecisionVersionRef,
  EntityRef,
  EvidenceRef,
  Fingerprint,
  GateKind,
  GateValidity,
  HandoffVersionRef,
  IsoDateTime,
  ProgressStage,
  ProjectId,
  QuestionAnswerVersionRef,
  QuestionResultSnapshotRef,
  ReviewAssignmentRef,
  ReviewEpoch,
  ReviewPolicyVersionRef,
  Revision,
  ScopeClassificationRef,
  SrDescriptionVersionRef,
  SrScope,
  UserId,
  VersionRef,
} from './context';
import type {
  DomainError,
  GateAssessment,
  MarkdownDownload,
  ReviewImpact,
} from './results';
import type {
  CurrentScopeClassificationContent,
  DecisionContentFields,
  QContentFields,
} from './question-decision-content';

export type { GateAssessment, MarkdownDownload } from './results';

export type NoInput = Record<string, never>;
export type NonEmpty<T> = readonly [T, ...T[]];
export type DemoActorId = UserId;
export type TicketKey = string;
export type GenerationRunId = string;
export type HandoffId = string;

export interface DemoActorView {
  readonly actorId: UserId;
  readonly displayName: string;
  readonly projectId: ProjectId;
  readonly roles: readonly string[];
  readonly demo: true;
}

export interface WorkspaceView {
  readonly project: { readonly projectId: ProjectId; readonly teamId: string; readonly name: string };
  readonly actors: readonly DemoActorView[];
  readonly connection: { readonly kind: 'mock'; readonly available: boolean };
  readonly revision: Revision;
  readonly defaultPolicyRef?: ReviewPolicyVersionRef;
  readonly policies: readonly PolicyView[];
}

export interface NewSR {
  readonly key: string;
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
  readonly ownerId: UserId;
  readonly existingSystem?: boolean;
}

export interface SRDescriptionEdit {
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
  readonly changeReason: string;
}

export interface SRDescriptionView {
  readonly versionRef: SrDescriptionVersionRef;
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
  readonly authorId: UserId;
  readonly createdAt: IsoDateTime;
  readonly changeReason?: string;
}

export interface MockTicketView {
  readonly key: TicketKey;
  readonly url: string;
  readonly status: string;
  readonly mock: true;
}

export interface GateSummary {
  readonly gate: GateKind;
  readonly validity: GateValidity;
  readonly reviewEpoch: ReviewEpoch;
  readonly currentBundleRef?: BundleRef;
  readonly blockers: readonly string[];
}

export interface SRView {
  readonly scope: SrScope;
  readonly key: string;
  readonly title: string;
  readonly ownerId: UserId;
  readonly originalDescriptionRef: SrDescriptionVersionRef;
  readonly currentDescriptionRef: SrDescriptionVersionRef;
  readonly progressStage: ProgressStage;
  readonly revision: Revision;
  readonly gates: readonly GateSummary[];
  readonly reviewImpact?: ReviewImpact;
}

export type ImportOutcome =
  | { readonly kind: 'Imported'; readonly sr: SRView }
  | { readonly kind: 'Existing'; readonly sr: SRView; readonly ticketKey: TicketKey };

export type SourceInput =
  | {
      readonly kind: 'text' | 'markdown';
      readonly content: string;
      readonly provenance: string;
      readonly displayName?: string;
    }
  | {
      readonly kind: 'link';
      readonly targetUrl: string;
      readonly provenance: string;
      readonly verifiable: boolean;
      readonly displayName?: string;
      readonly observedExternalVersion?: string;
      readonly unavailableReason?: string;
    };

export interface SourceConfirmation {
  readonly sourceVersionRef: ContextSourceVersionRef;
  readonly confirmationEvidence: string;
}

interface ContextSourceViewBase {
  readonly scope: SrScope;
  readonly sourceId: string;
  readonly currentVersionRef: ContextSourceVersionRef;
  readonly revision: Revision;
  readonly createdBy: UserId;
  readonly createdAt: IsoDateTime;
  readonly displayName?: string;
  readonly provenance: string;
  readonly versionCreatedBy: UserId;
  readonly versionCreatedAt: IsoDateTime;
  readonly previousVersionRef?: ContextSourceVersionRef;
  readonly reviewImpact: ReviewImpact;
}

type ContextSourceContentView =
  | { readonly kind: 'text' | 'markdown'; readonly content: string }
  | {
      readonly kind: 'link';
      readonly targetUrl: string;
      readonly verifiable: boolean;
      readonly observedExternalVersion?: string;
      readonly unavailableReason?: string;
    };

type ContextSourceConfirmationView =
  | {
      readonly confirmation: 'unconfirmed';
      readonly confirmedBy?: never;
      readonly confirmedAt?: never;
      readonly confirmationEvidence?: never;
    }
  | {
      readonly confirmation: 'confirmed';
      readonly confirmedBy: UserId;
      readonly confirmedAt: IsoDateTime;
      readonly confirmationEvidence: string;
    };

export type ContextSourceView = ContextSourceViewBase &
  ContextSourceContentView & ContextSourceConfirmationView;

export type EvidenceInput =
  | { readonly refs: NonEmpty<EvidenceRef> }
  | { readonly text: string };

export type QuestionAnswerValue =
  | { readonly kind: 'choice'; readonly optionId: string; readonly text: string }
  | { readonly kind: 'free_text'; readonly text: string };

export interface QuestionAnswer {
  readonly questionId: string;
  readonly answeredQuestionSnapshotRef: QuestionResultSnapshotRef;
  readonly answer: QuestionAnswerValue;
  readonly evidence: EvidenceInput;
}

export type DocumentDisposition =
  | { readonly kind: 'reflected'; readonly artifactVersionRefs: NonEmpty<ArtifactVersionRef> }
  | { readonly kind: 'not_required'; readonly reason: string };

export interface QuestionResolution {
  readonly questionId: string;
  readonly selectedAnswerRef: QuestionAnswerVersionRef;
  readonly resolutionEvidence: EvidenceInput;
  readonly documentDisposition: DocumentDisposition;
}

export type QuestionClassificationInput =
  | { readonly scope: 'current'; readonly requiredGate: GateKind; readonly reason: string }
  | {
      readonly scope: 'followup';
      readonly requiredGate: 'None';
      readonly reason: string;
      readonly ownerId: UserId;
      readonly revisit:
        | { readonly kind: 'at'; readonly at: IsoDateTime }
        | { readonly kind: 'event'; readonly event: string };
    };

interface FollowupQuestionBase {
  readonly parentQuestionId: string;
  readonly text: string;
  readonly reason: string;
  readonly assigneeId: UserId;
  readonly classification: QuestionClassificationInput;
  readonly candidateAnswers?: readonly string[];
  readonly relatedArtifactRefs?: readonly ArtifactVersionRef[];
  readonly sourceRefs?: readonly ContextSourceVersionRef[];
  readonly dueAt?: IsoDateTime;
}

export type FollowupQuestion =
  | (FollowupQuestionBase & {
      readonly answerMode: 'choice';
      readonly options: NonEmpty<{ readonly optionId: string; readonly text: string }>;
    })
  | (FollowupQuestionBase & { readonly answerMode: 'free_text'; readonly options?: never });

export interface DecisionAlternative {
  readonly optionId: string;
  readonly label: string;
  readonly description: string;
}

export interface DecisionConversion {
  readonly questionId: string;
  readonly questionResultSnapshotRef: QuestionResultSnapshotRef;
  readonly prompt: string;
  readonly alternatives: NonEmpty<DecisionAlternative>;
  readonly impact: string;
  readonly decisionMakerId: UserId;
  readonly classificationRef: ScopeClassificationRef;
}

export interface DecisionConfirmation {
  readonly decisionId: string;
  readonly selection: { readonly optionId?: string; readonly text: string };
  readonly rationale: string;
  readonly evidence: EvidenceInput;
}

export interface DecisionRevision extends DecisionConfirmation {
  readonly previousVersionRef: DecisionVersionRef;
  readonly changeReason: string;
}

export type ScopeClassification =
  | {
      readonly targetRef: EntityRef<'question' | 'decision'>;
      readonly scope: 'current';
      readonly requiredGate: GateKind;
      readonly reason: string;
      readonly basisRefs?: readonly VersionRef[];
    }
  | {
      readonly targetRef: EntityRef<'question' | 'decision'>;
      readonly scope: 'followup';
      readonly requiredGate: 'None';
      readonly reason: string;
      readonly ownerId: UserId;
      readonly basisRefs?: readonly VersionRef[];
      readonly revisit:
        | { readonly kind: 'at'; readonly at: IsoDateTime }
        | { readonly kind: 'event'; readonly event: string };
    };

export interface QuestionView extends QContentFields {
  readonly scope: SrScope;
  readonly questionId: string;
  readonly status: 'open' | 'answered' | 'resolved' | 'converted_to_decision';
  readonly revision: Revision;
  readonly allowedActions: readonly string[];
  readonly reviewImpact: ReviewImpact;
}

export interface DecisionView extends DecisionContentFields {
  readonly scope: SrScope;
  readonly decisionId: string;
  readonly state: 'unconfirmed' | 'confirmed';
  readonly revision: Revision;
  readonly allowedActions: readonly string[];
  readonly reviewImpact: ReviewImpact;
}

export interface ScopeView {
  readonly targetRef: EntityRef<'question' | 'decision'>;
  readonly classificationRef: ScopeClassificationRef;
  readonly classification: CurrentScopeClassificationContent;
  readonly scope: 'current' | 'followup';
  readonly requiredGate: GateKind | 'None';
  readonly revision: Revision;
  readonly reviewImpact: ReviewImpact;
}

export interface SectionIndexEntry {
  readonly sectionId: string;
  readonly title: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface RequirementLink {
  readonly requirementId: string;
  readonly sectionIds: NonEmpty<string>;
  readonly acceptanceCriteria: readonly string[];
}

export type ArtifactTargetBasis =
  | { readonly kind: 'absent'; readonly logicalKey: string }
  | { readonly kind: 'version'; readonly ref: ArtifactVersionRef };

interface ArtifactEditBase {
  readonly artifactId?: string;
  readonly markdown: string;
  readonly sectionIndex: readonly SectionIndexEntry[];
  readonly requirementLinks: readonly RequirementLink[];
  readonly changeSummary: string;
  readonly targetBasis: ArtifactTargetBasis;
  readonly decisionRefs?: readonly DecisionVersionRef[];
  readonly sourceRefs?: readonly ContextSourceVersionRef[];
  readonly questionResultRefs?: readonly QuestionResultSnapshotRef[];
}

export type ArtifactEdit =
  | (ArtifactEditBase & {
      readonly kind: 'requirements' | 'workflow_plan' | 'implementation_plan';
      readonly designStage?: never;
    })
  | (ArtifactEditBase & {
      readonly kind: 'design';
      readonly designStage: 'application' | 'functional' | 'nfr' | 'infrastructure';
    });

export interface ArtifactVersionPair {
  readonly before: ArtifactVersionRef;
  readonly after: ArtifactVersionRef;
}

export type WorkflowStageInput =
  | { readonly stageId: string; readonly choice: 'executed'; readonly designArtifactRefs: readonly ArtifactVersionRef[] }
  | { readonly stageId: string; readonly choice: 'skipped'; readonly reason: string };

export interface RequirementTaskLink {
  readonly taskId: string;
  readonly requirementIds: NonEmpty<string>;
  readonly verification: NonEmpty<string>;
  readonly order: number;
}

export interface WorkflowPlanEdit extends Omit<ArtifactEditBase, 'artifactId'> {
  readonly artifactId?: string;
  readonly kind: 'workflow_plan';
  readonly workflowVersion: 'v1.0.1';
  readonly stages: NonEmpty<WorkflowStageInput>;
  readonly implementationUnitCount: 1;
  readonly requirementTaskLinks: NonEmpty<RequirementTaskLink>;
}

export type DraftArtifactEdit =
  | (ArtifactEditBase & {
      readonly kind: 'requirements' | 'implementation_plan';
      readonly designStage?: never;
    })
  | (ArtifactEditBase & {
      readonly kind: 'design';
      readonly designStage: 'application' | 'functional' | 'nfr' | 'infrastructure';
    })
  | WorkflowPlanEdit;

export interface ArtifactView {
  readonly scope: SrScope;
  readonly artifactId: string;
  readonly kind: 'requirements' | 'workflow_plan' | 'design' | 'implementation_plan';
  readonly designStage?: 'application' | 'functional' | 'nfr' | 'infrastructure';
  readonly versionRef: ArtifactVersionRef;
  readonly markdown: string;
  readonly sectionIndex: readonly SectionIndexEntry[];
  readonly requirementLinks: readonly RequirementLink[];
  readonly authorOrigin: 'human' | 'ai_applied';
  readonly authorId: UserId;
  readonly createdAt: IsoDateTime;
  readonly changeSummary: string;
  readonly previousVersionRef?: ArtifactVersionRef;
  readonly draftApplicationId?: string;
  readonly inputSnapshotId?: string;
  readonly decisionRefs: readonly DecisionVersionRef[];
  readonly sourceRefs: readonly ContextSourceVersionRef[];
  readonly questionResultRefs: readonly QuestionResultSnapshotRef[];
  readonly revision: Revision;
  readonly reviewImpact: ReviewImpact;
}

export interface WorkflowPlanView extends ArtifactView {
  readonly kind: 'workflow_plan';
  readonly workflowVersion: 'v1.0.1';
  readonly stages: readonly WorkflowStageInput[];
  readonly implementationUnitCount: 1;
  readonly requirementTaskLinks: readonly RequirementTaskLink[];
}

export interface ArtifactDiffView {
  readonly before: ArtifactView;
  readonly after: ArtifactView;
  readonly changedRequirementIds: readonly string[];
  readonly changedDecisionRefs: readonly DecisionVersionRef[];
  readonly changedSectionIds: readonly string[];
}

export type DraftSelectedContent =
  | { readonly kind: 'artifact'; readonly edit: DraftArtifactEdit }
  | { readonly kind: 'questions'; readonly temporaryIds: NonEmpty<string> }
  | {
      readonly kind: 'decisions';
      readonly selections: NonEmpty<{
        readonly temporaryId: string;
        readonly decisionMakerId: UserId;
        readonly classification: QuestionClassificationInput;
      }>;
    };

interface DraftApplicationBase {
  readonly draftId: string;
  readonly applicationReason?: string;
}

export type DraftApplication =
  | (DraftApplicationBase & {
      readonly selectedContent: Extract<DraftSelectedContent, { readonly kind: 'artifact' }>;
    })
  | (DraftApplicationBase & {
      readonly selectedContent: Extract<DraftSelectedContent, { readonly kind: 'questions' }>;
      readonly targetBasis?: never;
    })
  | (DraftApplicationBase & {
      readonly selectedContent: Extract<DraftSelectedContent, { readonly kind: 'decisions' }>;
      readonly targetBasis?: never;
    });

export interface ReviewedDraftInput {
  readonly sourceDraftId: string;
  readonly currentInputFingerprint: Fingerprint;
  readonly body: GenerationResult;
  readonly comparisonSummary: string;
}

export interface DraftEntityMapping<K extends 'question' | 'decision'> {
  readonly temporaryId: string;
  readonly ref: EntityRef<K>;
}

export type DraftApplicationResult =
  | { readonly kind: 'artifact'; readonly artifactVersionRef: ArtifactVersionRef }
  | { readonly kind: 'questions'; readonly mappings: NonEmpty<DraftEntityMapping<'question'>> }
  | { readonly kind: 'decisions'; readonly mappings: NonEmpty<DraftEntityMapping<'decision'>> };

export interface AppliedDraftView {
  readonly applicationId: string;
  readonly draftId: string;
  readonly result: DraftApplicationResult;
  readonly reviewImpact: ReviewImpact;
}

export interface UnconfirmedDecisionSnapshot {
  readonly decisionId: string;
  readonly revision: Revision;
  readonly prompt: string;
  readonly alternatives: NonEmpty<DecisionAlternative>;
  readonly impact: string;
  readonly decisionMakerId: UserId;
  readonly classificationRef: ScopeClassificationRef;
}

interface ReviewRequestBase {
  readonly artifactVersionRefs: readonly ArtifactVersionRef[];
  readonly decisionVersionRefs: readonly DecisionVersionRef[];
  readonly unconfirmedDecisionSnapshots: readonly UnconfirmedDecisionSnapshot[];
  readonly questionResultRefs: readonly QuestionResultSnapshotRef[];
  readonly classificationRefs: readonly ScopeClassificationRef[];
  readonly contextSourceVersionRefs: readonly ContextSourceVersionRef[];
  readonly assignmentRef: ReviewAssignmentRef;
  readonly reviewerIds: readonly UserId[];
  readonly policyRef: ReviewPolicyVersionRef;
}

export type ReviewRequestInput =
  | (ReviewRequestBase & { readonly gate: 'G1' })
  | (ReviewRequestBase & { readonly gate: 'G2'; readonly g1BundleRef: BundleRef<'G1'> });

export interface ChecklistResult {
  readonly itemId: string;
  readonly checked: true;
}

export interface ApprovalInput {
  readonly bundleRef: BundleRef;
  readonly reviewEpoch: ReviewEpoch;
  readonly checklistResults: NonEmpty<ChecklistResult>;
  readonly approvalScope: GateKind;
  readonly comment?: string;
}

export interface CommentInput {
  readonly artifactVersionRef: ArtifactVersionRef;
  readonly sectionId: string;
  readonly body: string;
  readonly bundleRef?: BundleRef;
}

export interface ChangeRequestInput {
  readonly bundleRef?: BundleRef;
  readonly artifactVersionRef: ArtifactVersionRef;
  readonly sectionId: string;
  readonly body: string;
  readonly blocking: boolean;
  readonly affectedGate: GateKind;
  readonly assigneeId: UserId;
  readonly dueAt?: IsoDateTime;
}

export interface ChangeApplication {
  readonly changeRequestId: string;
  readonly appliedArtifactVersionRef: ArtifactVersionRef;
  readonly applicationSummary: string;
  readonly evidence: EvidenceInput;
}

export interface ChangeConfirmation {
  readonly changeRequestId: string;
  readonly applicationEventRef: EntityRef<'change_request_event'>;
  readonly appliedArtifactVersionRef: ArtifactVersionRef;
  readonly result: { readonly kind: 'resolved'; readonly verification: string };
}

export interface ChangeFeedback {
  readonly changeRequestId: string;
  readonly currentApplicationEventRef?: EntityRef<'change_request_event'>;
  readonly unresolvedSummary: string;
  readonly feedback: string;
}

export interface ReviewBundleSnapshot {
  readonly bundleRef: BundleRef;
  readonly reviewEpoch: ReviewEpoch;
  readonly artifactVersionRefs: readonly ArtifactVersionRef[];
  readonly decisionVersionRefs: readonly DecisionVersionRef[];
  readonly unconfirmedDecisionSnapshots: readonly UnconfirmedDecisionSnapshot[];
  readonly questionResultRefs: readonly QuestionResultSnapshotRef[];
  readonly classificationRefs: readonly ScopeClassificationRef[];
  readonly contextSourceVersionRefs: readonly ContextSourceVersionRef[];
  readonly assignmentRef: ReviewAssignmentRef;
  readonly reviewerIds: readonly UserId[];
  readonly policyRef: ReviewPolicyVersionRef;
  readonly checklistSnapshot: NonEmpty<{ readonly itemId: string; readonly label: string }>;
  readonly descriptionRef: SrDescriptionVersionRef;
  readonly createdBy: UserId;
  readonly createdAt: IsoDateTime;
  readonly previousBundleRef?: BundleRef;
  readonly g1BundleRef?: BundleRef<'G1'>;
}

export type ReviewBundleView =
  | {
      readonly kind: 'BundleAvailable';
      readonly bundle: ReviewBundleSnapshot;
      readonly requestIds: readonly string[];
    }
  | {
      readonly kind: 'NeedsInputs';
      readonly gate: GateKind;
      readonly missing: readonly string[];
      readonly assigneeIds: readonly UserId[];
    };

export interface ApprovalView {
  readonly approvalId: string;
  readonly bundleRef: BundleRef;
  readonly reviewEpoch: ReviewEpoch;
  readonly policyRef: ReviewPolicyVersionRef;
  readonly approverId: UserId;
  readonly checklistResults: NonEmpty<ChecklistResult>;
  readonly approvalScope: GateKind;
  readonly result: 'approved';
  readonly approvedAt: IsoDateTime;
  readonly comment?: string;
}

export interface ReviewRequestView {
  readonly requestId: string;
  readonly bundleRef: BundleRef;
  readonly reviewEpoch: ReviewEpoch;
  readonly reviewerId: UserId;
  readonly requestKind: string;
  readonly requestedBy: UserId;
  readonly requestedAt: IsoDateTime;
  readonly status: 'pending' | 'handled' | 'superseded';
  readonly revision: Revision;
  readonly resultRef?: EntityRef<'approval'>;
  readonly handledAt?: IsoDateTime;
  readonly supersededByRequestId?: string;
}

export interface CommentView extends CommentInput {
  readonly commentId: string;
  readonly authorId: UserId;
  readonly createdAt: IsoDateTime;
}

export type ChangeRequestTarget =
  | ArtifactVersionRef
  | { readonly kind: 'missing_section'; readonly sectionId: string };

export interface ChangeRequestEventView {
  readonly eventRef: EntityRef<'change_request_event'>;
  readonly changeRequestId: string;
  readonly kind: 'applied' | 'resolved' | 'further_change' | 'carried';
  readonly actorId: UserId;
  readonly occurredAt: IsoDateTime;
  readonly beforeStatus: 'open' | 'awaiting_confirmation' | 'resolved';
  readonly afterStatus: 'open' | 'awaiting_confirmation' | 'resolved';
  readonly targetArtifactVersionRef: ArtifactVersionRef;
  readonly applicationSummary?: string;
  readonly evidence?: EvidenceInput;
  readonly applicationEventRef?: EntityRef<'change_request_event'>;
  readonly verification?: string;
  readonly unresolvedSummary?: string;
  readonly feedback?: string;
  readonly beforeTargetRef?: ChangeRequestTarget;
  readonly afterTargetRef?: ChangeRequestTarget;
}

export interface ChangeRequestView {
  readonly changeRequestId: string;
  readonly originalTargetVersionRef: ArtifactVersionRef;
  readonly originalSectionId: string;
  readonly body: string;
  readonly affectedGate: GateKind;
  readonly currentTargetRef: ArtifactVersionRef | { readonly kind: 'missing_section'; readonly sectionId: string };
  readonly status: 'open' | 'awaiting_confirmation' | 'resolved';
  readonly blocking: boolean;
  readonly assigneeId: UserId;
  readonly requesterId: UserId;
  readonly revision: Revision;
  readonly requestedAt: IsoDateTime;
  readonly dueAt?: IsoDateTime;
  readonly bundleRef?: BundleRef;
  readonly currentApplicationEventRef?: EntityRef<'change_request_event'>;
  readonly currentResolutionEventRef?: EntityRef<'change_request_event'>;
  readonly appliedArtifactVersionRef?: ArtifactVersionRef;
  readonly events: readonly ChangeRequestEventView[];
}

export interface StageTransition {
  readonly toStage: ProgressStage;
  readonly reason: string;
  readonly gate?: GateKind;
  readonly bundleRef?: BundleRef;
}

export interface GatePolicy {
  readonly requiredRoles: NonEmpty<string>;
  readonly checklist: NonEmpty<{ readonly itemId: string; readonly label: string }>;
}

interface PolicyEditBase {
  readonly description?: string;
  readonly gates: { readonly G1: GatePolicy; readonly G2: GatePolicy };
  readonly requireAllAssigned: true;
  readonly requireDistinctPeer: true;
}

export type PolicyEdit =
  | (PolicyEditBase & { readonly previousPolicyRef?: never; readonly changeReason?: never })
  | (PolicyEditBase & {
      readonly previousPolicyRef: ReviewPolicyVersionRef;
      readonly changeReason: string;
    });

export type ReviewerAssignment =
  | { readonly gate: GateKind; readonly reviewerIds: readonly UserId[] }
  | {
      readonly gate: GateKind;
      readonly reviewerIds: readonly UserId[];
      readonly previousAssignmentRef: ReviewAssignmentRef;
      readonly changeReason: string;
    };

export interface PolicyApplication {
  readonly policyRef: ReviewPolicyVersionRef;
  readonly gates: NonEmpty<GateKind>;
}

export interface PolicyApplicationResult {
  readonly policyRef: ReviewPolicyVersionRef;
  readonly gates: NonEmpty<{
    readonly gate: GateKind;
    readonly result: ReviewBundleView;
  }>;
  readonly reviewImpact: ReviewImpact;
}

export interface PolicyView {
  readonly policyRef: ReviewPolicyVersionRef;
  readonly description?: string;
  readonly gates: { readonly G1: GatePolicy; readonly G2: GatePolicy };
}

export interface ReviewAssignmentView {
  readonly assignmentRef: ReviewAssignmentRef;
  readonly gate: GateKind;
  readonly reviewerIds: readonly UserId[];
  readonly ready: boolean;
  readonly notReadyReason?: string;
}

export interface ReviewConfigurationView {
  readonly gate: GateKind;
  readonly reviewEpoch: ReviewEpoch;
  readonly revision: Revision;
  readonly needsNewBundle: boolean;
  readonly validity: GateValidity;
  readonly policy?: PolicyView;
  readonly assignment?: ReviewAssignmentView;
  readonly currentBundleRef?: BundleRef;
  readonly lastPassTransitionId?: string;
}

export type ReviewPreparationView =
  | {
      readonly kind: 'Ready';
      readonly gate: GateKind;
      readonly gateRevision: Revision;
      readonly input: ReviewRequestInput;
      readonly checklistSnapshot: NonEmpty<{ readonly itemId: string; readonly label: string }>;
    }
  | {
      readonly kind: 'NeedsInputs';
      readonly gate: GateKind;
      readonly gateRevision: Revision;
      readonly missing: readonly string[];
      readonly assigneeIds: readonly UserId[];
    };

export type GenerationTaskKind =
  | 'QUESTION_PROPOSALS'
  | 'DECISION_PROPOSALS'
  | 'ARTIFACT_DRAFT'
  | 'ARTIFACT_REVISION';
export type DocumentKind = 'requirements' | 'workflow_plan' | 'design' | 'implementation_plan';

export type GenerationInput =
  | { readonly taskKind: 'QUESTION_PROPOSALS' | 'DECISION_PROPOSALS'; readonly supplement?: string }
  | {
      readonly taskKind: 'ARTIFACT_DRAFT';
      readonly documentKind: DocumentKind;
      readonly targetBasis: { readonly kind: 'absent'; readonly logicalKey: string };
      readonly supplement?: string;
    }
  | {
      readonly taskKind: 'ARTIFACT_REVISION';
      readonly documentKind: DocumentKind;
      readonly targetBasis: { readonly kind: 'version'; readonly ref: ArtifactVersionRef };
      readonly supplement?: string;
    };

export interface ProviderSelection {
  readonly providerId: string;
  readonly modelChoice:
    | { readonly kind: 'installed_default' }
    | { readonly kind: 'explicit'; readonly modelId: string };
}

export interface SnapshotContentItem {
  readonly ref: EntityRef | VersionRef;
  readonly content: string;
  readonly confirmation: 'confirmed' | 'unconfirmed' | 'not_applicable';
}

interface InputSnapshotBase {
  readonly scope: SrScope;
  readonly snapshotId: string;
  readonly workflowVersion: 'v1.0.1';
  readonly contentFingerprint: Fingerprint;
  readonly contents: readonly SnapshotContentItem[];
  readonly projectRules: readonly {
    readonly logicalId: string;
    readonly version: string;
    readonly content: string;
  }[];
  readonly supplement?: string;
  readonly capturedAt: IsoDateTime;
}

export type InputSnapshot =
  | (InputSnapshotBase & {
      readonly taskKind: 'QUESTION_PROPOSALS' | 'DECISION_PROPOSALS';
      readonly documentKind?: never;
      readonly targetBasis?: never;
    })
  | (InputSnapshotBase & {
      readonly taskKind: 'ARTIFACT_DRAFT';
      readonly documentKind: DocumentKind;
      readonly targetBasis: Extract<ArtifactTargetBasis, { readonly kind: 'absent' }>;
    })
  | (InputSnapshotBase & {
      readonly taskKind: 'ARTIFACT_REVISION';
      readonly documentKind: DocumentKind;
      readonly targetBasis: Extract<ArtifactTargetBasis, { readonly kind: 'version' }>;
    });

export type QuestionProposal = {
  readonly temporaryId: string;
  readonly text: string;
  readonly reason: string;
  readonly suggestedAssigneeId: UserId;
  readonly requiredGate: GateKind;
  readonly sourceRefs: readonly VersionRef[];
  readonly candidateAnswers: readonly string[];
};

export type DecisionProposal = {
  readonly temporaryId: string;
  readonly prompt: string;
  readonly alternatives: NonEmpty<DecisionAlternative>;
  readonly impact: string;
  readonly recommendation: string;
  readonly sourceRefs: readonly VersionRef[];
};

export type GenerationResult =
  | { readonly schemaVersion: 1; readonly kind: 'question_proposals'; readonly proposals: NonEmpty<QuestionProposal> }
  | { readonly schemaVersion: 1; readonly kind: 'decision_proposals'; readonly proposals: NonEmpty<DecisionProposal> }
  | {
      readonly schemaVersion: 1;
      readonly kind: 'artifact';
      readonly documentKind: DocumentKind;
      readonly markdown: string;
      readonly requirementRefs: readonly string[];
      readonly changeSummary: string;
    };

export type DraftApplicationStatus =
  | { readonly kind: 'not_applied' }
  | {
      readonly kind: 'applied';
      readonly applicationId: string;
      readonly result: DraftApplicationResult;
    };

export type InputFreshness =
  | 'current'
  | 'stale'
  | {
      readonly kind: 'unknown';
      readonly reason: string;
    };

export type GenerationPreparationRequest =
  | { readonly kind: 'new_generation'; readonly input: GenerationInput }
  | { readonly kind: 'retry'; readonly runId: GenerationRunId }
  | { readonly kind: 'draft'; readonly draftId: string };

interface GenerationPreparationBase {
  readonly input: GenerationInput;
  readonly expectedInputFingerprint: Fingerprint;
  readonly basisRefs: readonly VersionRef[];
  readonly projectRuleVersions: readonly {
    readonly logicalId: string;
    readonly version: string;
  }[];
}

export type GenerationPreparationView =
  | (GenerationPreparationBase & { readonly kind: 'new_generation' })
  | (GenerationPreparationBase & { readonly kind: 'retry'; readonly runId: GenerationRunId })
  | (GenerationPreparationBase & {
      readonly kind: 'draft';
      readonly draftId: string;
      readonly draftBasisFingerprint: Fingerprint;
      readonly currentInputFingerprint: Fingerprint;
      readonly freshness: 'current' | 'stale';
      readonly draftTargetBasis?: ArtifactTargetBasis;
      readonly currentTargetBasis?: ArtifactTargetBasis;
    });

export interface DraftView {
  readonly draftId: string;
  readonly schemaVersion: 1;
  readonly taskKind: GenerationTaskKind;
  readonly body: GenerationResult;
  readonly basisInputSnapshotRef: string;
  readonly basisFingerprint: Fingerprint;
  readonly provenance:
    | { readonly kind: 'provider'; readonly sourceRunId: string }
    | {
        readonly kind: 'human_review';
        readonly sourceDraftId: string;
        readonly reviewedBy: UserId;
        readonly reviewedAt: IsoDateTime;
        readonly comparisonSummary: string;
      };
  readonly freshness: InputFreshness;
  readonly staleReason?: string;
  readonly application: DraftApplicationStatus;
}

export interface GenerationDraftIndexView {
  readonly draftId: string;
  readonly taskKind: GenerationTaskKind;
  readonly basisInputSnapshotRef: string;
  readonly basisFingerprint: Fingerprint;
  readonly provenance: DraftView['provenance'];
  readonly freshness: InputFreshness;
  readonly application: DraftApplicationStatus;
}

export interface DraftReviewView {
  readonly draft: DraftView;
  readonly inputSnapshot: InputSnapshot;
}

export interface GenerationPreparationUnavailableView {
  readonly reason: string;
}

interface GenerationRunViewBase {
  readonly scope: SrScope;
  readonly runId: string;
  readonly taskKind: GenerationTaskKind;
  readonly inputSnapshotId: string;
  readonly revision: Revision;
  readonly requestedBy: UserId;
  readonly requestedAt: IsoDateTime;
  readonly requestedSelection: ProviderSelection;
  readonly actualModelId?: string;
  readonly cliVersion?: string;
  readonly freshness: InputFreshness;
  readonly termination: 'unobserved' | 'confirmed';
  readonly application: DraftApplicationStatus;
}

export type GenerationRunView =
  | (GenerationRunViewBase & { readonly status: 'pending' })
  | (GenerationRunViewBase & { readonly status: 'running'; readonly startedAt: IsoDateTime })
  | (GenerationRunViewBase & {
      readonly status: 'succeeded';
      readonly draft: DraftView;
      readonly finishedAt: IsoDateTime;
    })
  | (GenerationRunViewBase & {
      readonly status: 'failed';
      readonly error: { readonly code: string; readonly diagnostic: string };
      readonly finishedAt: IsoDateTime;
    })
  | (GenerationRunViewBase & {
      readonly status: 'cancelled';
      readonly cancelledBy: UserId;
      readonly cancelledAt: IsoDateTime;
    });

export interface ClaimedRun {
  readonly claimRef: import('./context').ClaimRef;
  readonly snapshot: InputSnapshot;
  readonly selection: ProviderSelection;
  readonly executionPolicy: ExecutionPolicy;
}

export interface ExecutionPolicy {
  readonly profileVersion: string;
  readonly timeoutMs: 300_000;
  readonly stdoutMaxBytes: 4_194_304;
  readonly stderrMaxBytes: 262_144;
  readonly normalizedResultMaxBytes: 2_097_152;
}

export interface ExecutionReport {
  readonly providerId: string;
  readonly actualModelId?: string;
  readonly cliVersion?: string;
  readonly profileVersion: string;
  readonly startedAt: IsoDateTime;
  readonly finishedAt: IsoDateTime;
  readonly exitCode?: number;
  readonly terminationSignal?: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutClosed: boolean;
  readonly stderrClosed: boolean;
}

export interface ProviderCompletion {
  readonly claimRef: import('./context').ClaimRef;
  readonly result: GenerationResult;
  readonly execution: ExecutionReport;
}

export interface ProviderFailureCore {
  readonly code:
    | 'EXECUTABLE_NOT_FOUND'
    | 'UNAVAILABLE'
    | 'PROVIDER_ERROR'
    | 'PROCESS_FAILED'
    | 'INVALID_OUTPUT'
    | 'TIMEOUT'
    | 'OUTPUT_LIMIT'
    | 'CANCELLED'
    | 'POLICY_CONFLICT';
  readonly diagnostic: string;
}

export interface ProviderFailure {
  readonly claimRef: import('./context').ClaimRef;
  readonly failure: ProviderFailureCore;
  readonly execution: ExecutionReport;
}

export type RunCompletionOutcome =
  | { readonly kind: 'Recorded'; readonly run: GenerationRunView }
  | { readonly kind: 'IgnoredTerminal'; readonly run: GenerationRunView }
  | { readonly kind: 'RejectedOwnership'; readonly error: DomainError };

export interface RecoverySummary {
  readonly inspectedCount: number;
  readonly recoveredRunIds: readonly string[];
  readonly failedRunIds: readonly string[];
  readonly unresolvedRunIds: readonly string[];
  readonly recoveryPolicyRef: string;
}

export interface RunControlView {
  readonly runId: string;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly cancelRequested: boolean;
  readonly termination: 'unobserved' | 'confirmed';
}

export interface ExecutionTermination {
  readonly claimRef: import('./context').ClaimRef;
  readonly observedAt: IsoDateTime;
  readonly result:
    | { readonly kind: 'exited'; readonly exitCode: number; readonly signal?: string }
    | { readonly kind: 'no_process_created'; readonly evidence: string }
    | {
        readonly kind: 'restricted_scope_exited';
        readonly scopePolicyRef: string;
        readonly exitCode: number | null;
        readonly signal?: string;
      }
    | { readonly kind: 'host_reboot_confirmed'; readonly evidence: string };
  readonly diagnostic?: string;
}

export interface ExecutionObservation {
  readonly observationId: string;
  readonly claimRef: import('./context').ClaimRef;
  readonly observationKind: 'termination_confirmed';
  readonly observedAt: IsoDateTime;
  readonly result: ExecutionTermination['result'];
}

export interface HandoffRequest {
  readonly g2BundleRef: BundleRef<'G2'>;
}

export interface HandoffView {
  readonly handoffRef: HandoffVersionRef;
  readonly g1BundleRef: BundleRef<'G1'>;
  readonly g2BundleRef: BundleRef<'G2'>;
  readonly approvalRefs: readonly EntityRef<'approval'>[];
  readonly artifactVersionRefs: readonly ArtifactVersionRef[];
  readonly decisionVersionRefs: readonly DecisionVersionRef[];
  readonly questionResultRefs: readonly QuestionResultSnapshotRef[];
  readonly workflowVersion: 'v1.0.1';
  readonly markdownSnapshot: string;
  readonly currentValidity: GateValidity;
}

export interface HandoffPreview extends HandoffView {
  readonly currentReasons: readonly string[];
}

export interface ImplementationStart {
  readonly handoffId: HandoffId;
}

export interface ExternalEvidence {
  readonly kind: 'pr' | 'verification' | 'link';
  readonly label: string;
  readonly value: string;
}

export interface ImplementationCompletion {
  readonly implementationId: string;
  readonly completionSummary: string;
  readonly evidence: NonEmpty<ExternalEvidence>;
}

interface ImplementationViewBase {
  readonly implementationId: string;
  readonly handoffRef: HandoffVersionRef;
  readonly startedBy: UserId;
  readonly startedAt: IsoDateTime;
  readonly activeForCurrentSr: boolean;
  readonly revision: Revision;
}

export type ImplementationView =
  | (ImplementationViewBase & { readonly status: 'started' })
  | (ImplementationViewBase & {
      readonly status: 'completed';
      readonly completedBy: UserId;
      readonly completedAt: IsoDateTime;
      readonly completionSummary: string;
      readonly evidence: NonEmpty<ExternalEvidence>;
    });

export interface BoardFilter {
  readonly search?: string;
  readonly stages?: readonly ProgressStage[];
  readonly gates?: readonly GateKind[];
  readonly blocked?: boolean;
  readonly ownerIds?: readonly UserId[];
}

export interface InboxFilter {
  readonly kinds?: readonly ('question' | 'decision' | 'review' | 'change' | 'confirmation')[];
  readonly srId?: string;
  readonly overdue?: boolean;
}

export interface HistoryFilter {
  readonly eventTypes?: readonly string[];
  readonly actorIds?: readonly UserId[];
  readonly targetRef?: EntityRef;
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
}

export interface BoardCardView {
  readonly sr: SRView;
  readonly reviewStatus: string;
  readonly blockers: readonly string[];
  readonly nextActions: readonly string[];
}

export interface BoardView {
  readonly projectId: ProjectId;
  readonly cards: readonly BoardCardView[];
  readonly truncated: boolean;
  readonly revision: Revision;
}

export interface InboxItemView {
  readonly itemId: string;
  readonly kind: 'question' | 'decision' | 'review' | 'change' | 'confirmation';
  readonly srId: string;
  readonly targetRef: EntityRef;
  readonly dueAt?: IsoDateTime;
  readonly blocksCurrentStage: boolean;
  readonly requestedDirectly: boolean;
  readonly updatedAt: IsoDateTime;
  readonly nextAction: string;
}

export interface InboxView {
  readonly projectId: ProjectId;
  readonly actorId: UserId;
  readonly items: readonly InboxItemView[];
  readonly truncated: boolean;
  readonly revision: Revision;
}

export interface SRDetailView {
  readonly sr: SRView;
  readonly originalDescription: SRDescriptionView;
  readonly currentDescription: SRDescriptionView;
  readonly mockTicket?: MockTicketView;
  readonly sources: readonly ContextSourceView[];
  readonly artifacts: readonly ArtifactView[];
  readonly questions: readonly QuestionView[];
  readonly decisions: readonly DecisionView[];
  readonly bundles: readonly ReviewBundleSnapshot[];
  readonly reviewRequests: readonly ReviewRequestView[];
  readonly approvals: readonly ApprovalView[];
  readonly gateAssessments: readonly GateAssessment[];
  readonly reviewConfigurations: readonly ReviewConfigurationView[];
  readonly reviewPreparations: readonly ReviewPreparationView[];
  readonly comments: readonly CommentView[];
  readonly changeRequests: readonly ChangeRequestView[];
  readonly generationRuns: readonly GenerationRunView[];
  readonly generationDrafts: readonly GenerationDraftIndexView[];
  readonly implementations: readonly ImplementationView[];
  readonly preparation?: GenerationPreparationView;
  readonly draftReview?: DraftReviewView;
  readonly preparationUnavailable?: GenerationPreparationUnavailableView;
  readonly revision: Revision;
}

export interface ActivityItemView {
  readonly activityId: string;
  readonly eventType: string;
  readonly actorId: UserId;
  readonly targetRefs: readonly EntityRef[];
  readonly occurredAt: IsoDateTime;
  readonly description: string;
}

export interface ActivityView {
  readonly scope: { readonly projectId: ProjectId; readonly srId?: string };
  readonly items: readonly ActivityItemView[];
  readonly truncated: boolean;
  readonly revision: Revision;
}
