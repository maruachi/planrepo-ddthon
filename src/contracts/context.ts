export type ProjectId = string;
export type SrId = string;
export type UserId = string;
export type RuntimeId = string;
export type RequestId = string;
export type IdempotencyKey = string;
export type ReceiptId = string;
export type Fingerprint = string;
export type IsoDateTime = string;
export type Revision = number;
export type ReviewEpoch = number;
export type VersionNumber = number;

export type GateKind = 'G1' | 'G2';
export type GateValidity = 'not_passed' | 'valid' | 'invalid';
export type ProgressStage =
  | 'sr_received'
  | 'requirements'
  | 'planning'
  | 'ready'
  | 'implementing'
  | 'completed';

export interface ProjectScope {
  readonly kind: 'project';
  readonly projectId: ProjectId;
}

export interface SrScope {
  readonly kind: 'sr';
  readonly projectId: ProjectId;
  readonly srId: SrId;
}

export type TargetScope = ProjectScope | SrScope;

export type SrVersionKind =
  | 'sr_description'
  | 'context_source'
  | 'artifact'
  | 'question_answer'
  | 'question_result'
  | 'decision'
  | 'scope_classification'
  | 'review_assignment'
  | 'handoff';

export interface SrVersionRef<K extends SrVersionKind = SrVersionKind> {
  readonly kind: K;
  readonly projectId: ProjectId;
  readonly srId: SrId;
  readonly entityId: string;
  readonly version: VersionNumber;
}

export interface ReviewPolicyVersionRef {
  readonly kind: 'review_policy';
  readonly projectId: ProjectId;
  readonly entityId: string;
  readonly version: VersionNumber;
}

export type VersionRef = SrVersionRef | ReviewPolicyVersionRef;
export type SrDescriptionVersionRef = SrVersionRef<'sr_description'>;
export type ContextSourceVersionRef = SrVersionRef<'context_source'>;
export type ArtifactVersionRef = SrVersionRef<'artifact'>;
export type QuestionAnswerVersionRef = SrVersionRef<'question_answer'>;
export type QuestionResultSnapshotRef = SrVersionRef<'question_result'>;
export type DecisionVersionRef = SrVersionRef<'decision'>;
export type ScopeClassificationRef = SrVersionRef<'scope_classification'>;
export type ReviewAssignmentRef = SrVersionRef<'review_assignment'>;
export type HandoffVersionRef = SrVersionRef<'handoff'>;

export interface BundleRef<G extends GateKind = GateKind> {
  readonly projectId: ProjectId;
  readonly srId: SrId;
  readonly gate: G;
  readonly bundleId: string;
  readonly version: VersionNumber;
}

export type EntityKind =
  | 'project'
  | 'sr'
  | 'sr_description'
  | 'context_source'
  | 'artifact'
  | 'question'
  | 'question_answer'
  | 'question_result'
  | 'decision'
  | 'scope_classification'
  | 'review_policy'
  | 'review_assignment'
  | 'review_bundle'
  | 'review_gate_state'
  | 'review_request'
  | 'approval'
  | 'comment'
  | 'change_request'
  | 'change_request_event'
  | 'input_snapshot'
  | 'generation_run'
  | 'generation_draft'
  | 'draft_application'
  | 'handoff'
  | 'implementation'
  | 'activity';

export type ProjectEntityKind = 'project' | 'review_policy';
export type MixedScopeEntityKind = 'activity';
export type SrEntityKind = Exclude<EntityKind, ProjectEntityKind | MixedScopeEntityKind>;

interface EntityRefBase<K extends EntityKind> {
  readonly kind: K;
  readonly projectId: ProjectId;
  readonly entityId: string;
}

export type EntityRef<K extends EntityKind = EntityKind> = K extends SrEntityKind
  ? EntityRefBase<K> & { readonly srId: SrId }
  : K extends ProjectEntityKind
    ? EntityRefBase<K> & { readonly srId?: never }
    : EntityRefBase<K> & { readonly srId?: SrId };

export type EvidenceRef =
  | VersionRef
  | {
      readonly kind: 'external';
      readonly label: string;
      readonly url?: string;
      readonly verificationSummary: string;
    };

export interface ActorContext {
  readonly actorId: UserId;
  readonly projectId: ProjectId;
  readonly roles: readonly string[];
  readonly srAssignments: readonly string[];
  readonly demo: true;
}

export interface QueryContext<S extends TargetScope = TargetScope> {
  readonly actor: ActorContext;
  readonly scope: S;
}

export interface RuntimeContext {
  readonly runtimeId: RuntimeId;
  readonly ownershipCapability: string;
}

export interface ClaimRef {
  readonly runId: string;
  readonly claimId: string;
  readonly ownershipToken: string;
}

export interface NoGuard {
  readonly kind: 'none';
}

export interface RevisionExpectation<K extends EntityKind = EntityKind> {
  readonly target: EntityRef<K>;
  readonly expectedRevision: Revision;
}

export interface AbsentExpectation {
  readonly target: {
    readonly kind: 'artifact_logical_key';
    readonly projectId: ProjectId;
    readonly srId: SrId;
    readonly logicalKey: string;
  };
  readonly expected: 'absent';
}

export type ResourceExpectation<K extends EntityKind = EntityKind> =
  | RevisionExpectation<K>
  | AbsentExpectation;

export interface RevisionGuard<K extends EntityKind = EntityKind> {
  readonly resource: RevisionExpectation<K>;
}

export interface RevisionOrAbsentGuard<K extends EntityKind = EntityKind> {
  readonly resource: ResourceExpectation<K>;
}

export interface BundleGuard<G extends GateKind = GateKind> {
  readonly expectedBundleRef: BundleRef<G>;
  readonly expectedReviewEpoch: ReviewEpoch;
}

export interface FingerprintGuard {
  readonly expectedInputFingerprint: Fingerprint;
}

export type DraftApplicationGuard =
  | (FingerprintGuard & {
      readonly kind: 'artifact';
      readonly target: ResourceExpectation<'artifact'>;
    })
  | (FingerprintGuard & { readonly kind: 'questions' })
  | (FingerprintGuard & { readonly kind: 'decisions' });

export interface RevisionAndBundleGuard<
  K extends EntityKind = EntityKind,
  G extends GateKind = GateKind,
> extends BundleGuard<G> {
  readonly resource: RevisionExpectation<K>;
}

export interface RevisionAndFingerprintGuard<K extends EntityKind = EntityKind>
  extends FingerprintGuard {
  readonly resource: RevisionExpectation<K>;
}

export interface PolicyApplicationGuard {
  readonly resources: readonly RevisionExpectation<'review_gate_state'>[];
}

export type WriteGuard =
  | RevisionGuard
  | RevisionOrAbsentGuard
  | BundleGuard
  | FingerprintGuard
  | DraftApplicationGuard
  | RevisionAndBundleGuard
  | RevisionAndFingerprintGuard
  | PolicyApplicationGuard;

export interface CommandContext<
  S extends TargetScope = TargetScope,
  G extends WriteGuard | NoGuard = WriteGuard,
> {
  readonly actor: ActorContext;
  readonly scope: S;
  readonly requestId: RequestId;
  readonly idempotencyKey: IdempotencyKey;
  readonly guard: G;
}
