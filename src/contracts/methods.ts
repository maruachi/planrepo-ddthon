export const PUBLIC_METHOD_IDS = [
  'M-001', 'M-002', 'M-003', 'M-004', 'M-005', 'M-006', 'M-007', 'M-008',
  'M-009', 'M-010', 'M-011', 'M-012', 'M-013', 'M-014', 'M-015', 'M-016',
  'M-017', 'M-018', 'M-019', 'M-020', 'M-021', 'M-022', 'M-023', 'M-024',
  'M-025', 'M-026', 'M-027', 'M-028', 'M-029', 'M-030', 'M-031', 'M-032',
  'M-033', 'M-034', 'M-035', 'M-040', 'M-041', 'M-042', 'M-043', 'M-044',
  'M-045', 'M-046', 'M-047', 'M-048',
] as const;

export const INTERNAL_METHOD_IDS = [
  'M-036',
  'M-037',
  'M-038',
  'M-039',
  'M-049',
  'M-050',
] as const;

export const ALL_METHOD_IDS = [
  'M-001', 'M-002', 'M-003', 'M-004', 'M-005', 'M-006', 'M-007', 'M-008',
  'M-009', 'M-010', 'M-011', 'M-012', 'M-013', 'M-014', 'M-015', 'M-016',
  'M-017', 'M-018', 'M-019', 'M-020', 'M-021', 'M-022', 'M-023', 'M-024',
  'M-025', 'M-026', 'M-027', 'M-028', 'M-029', 'M-030', 'M-031', 'M-032',
  'M-033', 'M-034', 'M-035', 'M-036', 'M-037', 'M-038', 'M-039', 'M-040',
  'M-041', 'M-042', 'M-043', 'M-044', 'M-045', 'M-046', 'M-047', 'M-048',
  'M-049', 'M-050',
] as const;

export type PublicMethodId = (typeof PUBLIC_METHOD_IDS)[number];
export type InternalMethodId = (typeof INTERNAL_METHOD_IDS)[number];
export type MethodId = (typeof ALL_METHOD_IDS)[number];

import type {
  BundleGuard,
  ClaimRef,
  DraftApplicationGuard,
  FingerprintGuard,
  GateKind,
  NoGuard,
  PolicyApplicationGuard,
  ProjectScope,
  RevisionAndBundleGuard,
  RevisionGuard,
  RevisionOrAbsentGuard,
  RuntimeContext,
  SrScope,
  TargetScope,
} from './context';
import type { CommandResult } from './results';
import type * as V from './views';

type ServiceId = 'S-01' | 'S-02' | 'S-03' | 'S-04' | 'S-05' | 'S-06' | 'S-07' | 'S-08' | 'S-09';
type MethodMode = 'query' | 'command' | 'internal';
type ScopeKind = 'project' | 'sr' | 'target' | 'runtime';
type Visibility = 'public' | 'internal';

interface MethodSpec<
  Service extends ServiceId,
  Name extends string,
  Mode extends MethodMode,
  Scope extends ScopeKind,
  VisibilityKind extends Visibility,
  Input,
  Value,
  Guard,
> {
  readonly service: Service;
  readonly name: Name;
  readonly mode: Mode;
  readonly scope: Scope;
  readonly visibility: VisibilityKind;
  readonly input: Input;
  readonly value: Value;
  readonly guard: Guard;
}

type PublicQuery<S extends ServiceId, N extends string, Scope extends ScopeKind, I, O> = MethodSpec<
  S,
  N,
  'query',
  Scope,
  'public',
  I,
  O,
  NoGuard
>;
type PublicCommand<S extends ServiceId, N extends string, Scope extends 'project' | 'sr', I, O, G> =
  MethodSpec<S, N, 'command', Scope, 'public', I, O, G>;
type InternalMethod<N extends string, I, O, G = RuntimeContext> = MethodSpec<
  'S-07',
  N,
  'internal',
  'runtime',
  'internal',
  I,
  O,
  G
>;

export interface Methods {
  readonly 'M-001': PublicQuery<'S-01', 'describeWorkspace', 'project', V.NoInput, V.WorkspaceView>;
  readonly 'M-002': PublicQuery<'S-01', 'selectDemoActor', 'project', V.DemoActorId, V.DemoActorView>;
  readonly 'M-003': PublicCommand<'S-02', 'registerSr', 'project', V.NewSR, V.SRView, NoGuard>;
  readonly 'M-004': PublicCommand<'S-02', 'importMockTicket', 'project', V.TicketKey, V.ImportOutcome, NoGuard>;
  readonly 'M-005': PublicCommand<'S-02', 'updateSrDescription', 'sr', V.SRDescriptionEdit, V.SRView, RevisionGuard<'sr'>>;
  readonly 'M-006': PublicCommand<'S-02', 'attachSource', 'sr', V.SourceInput, V.ContextSourceView, RevisionGuard<'sr'>>;
  readonly 'M-007': PublicCommand<'S-02', 'confirmSource', 'sr', V.SourceConfirmation, V.ContextSourceView, RevisionGuard<'context_source'>>;
  readonly 'M-008': PublicCommand<'S-03', 'answerQuestion', 'sr', V.QuestionAnswer, V.QuestionView, RevisionGuard<'question'>>;
  readonly 'M-009': PublicCommand<'S-03', 'resolveQuestion', 'sr', V.QuestionResolution, V.QuestionView, RevisionGuard<'question'>>;
  readonly 'M-010': PublicCommand<'S-03', 'addFollowupQuestion', 'sr', V.FollowupQuestion, V.QuestionView, RevisionGuard<'question'>>;
  readonly 'M-011': PublicCommand<'S-03', 'convertQuestionToDecision', 'sr', V.DecisionConversion, V.DecisionView, RevisionGuard<'question'>>;
  readonly 'M-012': PublicCommand<'S-03', 'confirmDecision', 'sr', V.DecisionConfirmation, V.DecisionView, RevisionGuard<'decision'>>;
  readonly 'M-013': PublicCommand<'S-03', 'redecide', 'sr', V.DecisionRevision, V.DecisionView, RevisionGuard<'decision'>>;
  readonly 'M-014': PublicCommand<'S-03', 'classifyScope', 'sr', V.ScopeClassification, V.ScopeView, RevisionGuard<'question' | 'decision'>>;
  readonly 'M-015': PublicCommand<'S-04', 'saveArtifact', 'sr', V.ArtifactEdit, V.ArtifactView, RevisionOrAbsentGuard<'artifact'>>;
  readonly 'M-016': PublicQuery<'S-04', 'compareArtifacts', 'sr', V.ArtifactVersionPair, V.ArtifactDiffView>;
  readonly 'M-017': PublicCommand<'S-04', 'saveWorkflowPlan', 'sr', V.WorkflowPlanEdit, V.WorkflowPlanView, RevisionOrAbsentGuard<'artifact'>>;
  readonly 'M-018': PublicCommand<'S-04', 'applyDraft', 'sr', V.DraftApplication, V.AppliedDraftView, DraftApplicationGuard>;
  readonly 'M-019': PublicCommand<'S-04', 'createReviewedDraft', 'sr', V.ReviewedDraftInput, V.DraftView, FingerprintGuard>;
  readonly 'M-020': PublicCommand<'S-05', 'requestReview', 'sr', V.ReviewRequestInput, V.ReviewBundleView, RevisionGuard<'review_gate_state'>>;
  readonly 'M-021': PublicCommand<'S-05', 'recordApproval', 'sr', V.ApprovalInput, V.ApprovalView, BundleGuard>;
  readonly 'M-022': PublicCommand<'S-05', 'addComment', 'sr', V.CommentInput, V.CommentView, NoGuard>;
  readonly 'M-023': PublicCommand<'S-05', 'requestChange', 'sr', V.ChangeRequestInput, V.ChangeRequestView, RevisionAndBundleGuard<'review_gate_state'>>;
  readonly 'M-024': PublicCommand<'S-05', 'submitChangeResult', 'sr', V.ChangeApplication, V.ChangeRequestView, RevisionGuard<'change_request'>>;
  readonly 'M-025': PublicCommand<'S-05', 'confirmChangeResolution', 'sr', V.ChangeConfirmation, V.ChangeRequestView, RevisionGuard<'change_request'>>;
  readonly 'M-026': PublicCommand<'S-05', 'requestFurtherChange', 'sr', V.ChangeFeedback, V.ChangeRequestView, RevisionGuard<'change_request'>>;
  readonly 'M-027': PublicQuery<'S-05', 'assessGate', 'sr', GateKind, V.GateAssessment>;
  readonly 'M-028': PublicCommand<'S-05', 'transitionStage', 'sr', V.StageTransition, V.SRView, RevisionGuard<'sr'> | RevisionAndBundleGuard<'sr'>>;
  readonly 'M-029': PublicCommand<'S-06', 'createPolicyVersion', 'project', V.PolicyEdit, V.PolicyView, NoGuard>;
  readonly 'M-030': PublicCommand<'S-06', 'assignReviewers', 'sr', V.ReviewerAssignment, V.ReviewAssignmentView, RevisionGuard<'review_gate_state'>>;
  readonly 'M-031': PublicCommand<'S-06', 'applyPolicyToSr', 'sr', V.PolicyApplication, V.PolicyApplicationResult, PolicyApplicationGuard>;
  readonly 'M-032': PublicCommand<'S-07', 'requestGeneration', 'sr', V.GenerationInput, V.GenerationRunView, FingerprintGuard>;
  readonly 'M-033': PublicQuery<'S-07', 'getGeneration', 'sr', V.GenerationRunId, V.GenerationRunView>;
  readonly 'M-034': PublicCommand<'S-07', 'cancelGeneration', 'sr', V.GenerationRunId, V.GenerationRunView, NoGuard>;
  readonly 'M-035': PublicCommand<'S-07', 'retryGeneration', 'sr', V.GenerationRunId, V.GenerationRunView, FingerprintGuard>;
  readonly 'M-036': InternalMethod<'claimRun', V.NoInput, V.ClaimedRun | null>;
  readonly 'M-037': InternalMethod<'completeRun', V.ProviderCompletion, V.RunCompletionOutcome, ClaimRef>;
  readonly 'M-038': InternalMethod<'failRun', V.ProviderFailure, V.RunCompletionOutcome, ClaimRef>;
  readonly 'M-039': InternalMethod<'reconcileInterruptedRuns', V.NoInput, V.RecoverySummary>;
  readonly 'M-040': PublicCommand<'S-08', 'createHandoff', 'sr', V.HandoffRequest, V.HandoffView, BundleGuard<'G2'>>;
  readonly 'M-041': PublicQuery<'S-08', 'previewHandoff', 'sr', V.HandoffId, V.HandoffPreview>;
  readonly 'M-042': PublicCommand<'S-08', 'exportCurrentHandoff', 'sr', V.HandoffId, V.MarkdownDownload, BundleGuard<'G2'>>;
  readonly 'M-043': PublicCommand<'S-08', 'recordImplementationStart', 'sr', V.ImplementationStart, V.ImplementationView, RevisionAndBundleGuard<'sr', 'G2'>>;
  readonly 'M-044': PublicCommand<'S-08', 'recordImplementationCompletion', 'sr', V.ImplementationCompletion, V.ImplementationView, RevisionGuard<'implementation'>>;
  readonly 'M-045': PublicQuery<'S-09', 'getBoard', 'project', V.BoardFilter, V.BoardView>;
  readonly 'M-046': PublicQuery<'S-09', 'getInbox', 'project', V.InboxFilter, V.InboxView>;
  readonly 'M-047': PublicQuery<'S-09', 'getSrDetail', 'sr', V.NoInput | V.GenerationPreparationRequest, V.SRDetailView>;
  readonly 'M-048': PublicQuery<'S-09', 'getActivity', 'target', V.HistoryFilter, V.ActivityView>;
  readonly 'M-049': InternalMethod<'readRunControl', ClaimRef, V.RunControlView, ClaimRef>;
  readonly 'M-050': InternalMethod<'recordExecutionTermination', V.ExecutionTermination, V.ExecutionObservation, ClaimRef>;
}

export type MethodInput<M extends MethodId> = Methods[M]['input'];
export type MethodValue<M extends MethodId> = Methods[M]['value'];
export type GuardFor<M extends MethodId> = Methods[M]['guard'];
export type MethodOutput<M extends MethodId> = Methods[M]['mode'] extends 'command'
  ? CommandResult<MethodValue<M>>
  : MethodValue<M>;

type ScopeFor<K extends ScopeKind> = K extends 'project'
  ? ProjectScope
  : K extends 'sr'
    ? SrScope
    : K extends 'target'
      ? TargetScope
      : never;

type CommandMeta<G> = G extends NoGuard
  ? { readonly requestId: string; readonly idempotencyKey: string }
  : { readonly requestId: string; readonly idempotencyKey: string; readonly guard: G };

type DraftApplicationRequest<K extends 'artifact' | 'questions' | 'decisions'> = {
  readonly scope: SrScope;
  readonly input: Extract<V.DraftApplication, { readonly selectedContent: { readonly kind: K } }>;
  readonly meta: CommandMeta<Extract<GuardFor<'M-018'>, { readonly kind: K }>>;
};

export type PublicMethodRequest<M extends PublicMethodId> = M extends 'M-018'
  ? DraftApplicationRequest<'artifact'> | DraftApplicationRequest<'questions'> | DraftApplicationRequest<'decisions'>
  : Methods[M]['mode'] extends 'query'
    ? { readonly scope: ScopeFor<Methods[M]['scope']>; readonly input: MethodInput<M> }
    : {
        readonly scope: ScopeFor<Methods[M]['scope']>;
        readonly input: MethodInput<M>;
        readonly meta: CommandMeta<GuardFor<M>>;
      };

export type InternalMethodRequest<M extends InternalMethodId> = {
  readonly runtime: RuntimeContext;
  readonly input: MethodInput<M>;
};

export interface MethodDefinition {
  readonly service: ServiceId;
  readonly name: string;
  readonly mode: MethodMode;
  readonly scope: ScopeKind;
  readonly visibility: Visibility;
  readonly guard:
    | 'none'
    | 'revision'
    | 'revision-or-absent'
    | 'bundle'
    | 'fingerprint'
    | 'draft-application'
    | 'revision-and-bundle'
    | 'transition';
}

const define = <M extends MethodId>(
  definition: Omit<MethodDefinition, 'service' | 'name' | 'mode' | 'scope' | 'visibility'> &
    Pick<Methods[M], 'service' | 'name' | 'mode' | 'scope' | 'visibility'>,
) => definition;

export const METHOD_DEFINITIONS = {
  'M-001': define<'M-001'>({ service: 'S-01', name: 'describeWorkspace', mode: 'query', scope: 'project', visibility: 'public', guard: 'none' }),
  'M-002': define<'M-002'>({ service: 'S-01', name: 'selectDemoActor', mode: 'query', scope: 'project', visibility: 'public', guard: 'none' }),
  'M-003': define<'M-003'>({ service: 'S-02', name: 'registerSr', mode: 'command', scope: 'project', visibility: 'public', guard: 'none' }),
  'M-004': define<'M-004'>({ service: 'S-02', name: 'importMockTicket', mode: 'command', scope: 'project', visibility: 'public', guard: 'none' }),
  'M-005': define<'M-005'>({ service: 'S-02', name: 'updateSrDescription', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-006': define<'M-006'>({ service: 'S-02', name: 'attachSource', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-007': define<'M-007'>({ service: 'S-02', name: 'confirmSource', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-008': define<'M-008'>({ service: 'S-03', name: 'answerQuestion', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-009': define<'M-009'>({ service: 'S-03', name: 'resolveQuestion', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-010': define<'M-010'>({ service: 'S-03', name: 'addFollowupQuestion', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-011': define<'M-011'>({ service: 'S-03', name: 'convertQuestionToDecision', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-012': define<'M-012'>({ service: 'S-03', name: 'confirmDecision', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-013': define<'M-013'>({ service: 'S-03', name: 'redecide', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-014': define<'M-014'>({ service: 'S-03', name: 'classifyScope', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-015': define<'M-015'>({ service: 'S-04', name: 'saveArtifact', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision-or-absent' }),
  'M-016': define<'M-016'>({ service: 'S-04', name: 'compareArtifacts', mode: 'query', scope: 'sr', visibility: 'public', guard: 'none' }),
  'M-017': define<'M-017'>({ service: 'S-04', name: 'saveWorkflowPlan', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision-or-absent' }),
  'M-018': define<'M-018'>({ service: 'S-04', name: 'applyDraft', mode: 'command', scope: 'sr', visibility: 'public', guard: 'draft-application' }),
  'M-019': define<'M-019'>({ service: 'S-04', name: 'createReviewedDraft', mode: 'command', scope: 'sr', visibility: 'public', guard: 'fingerprint' }),
  'M-020': define<'M-020'>({ service: 'S-05', name: 'requestReview', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-021': define<'M-021'>({ service: 'S-05', name: 'recordApproval', mode: 'command', scope: 'sr', visibility: 'public', guard: 'bundle' }),
  'M-022': define<'M-022'>({ service: 'S-05', name: 'addComment', mode: 'command', scope: 'sr', visibility: 'public', guard: 'none' }),
  'M-023': define<'M-023'>({ service: 'S-05', name: 'requestChange', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision-and-bundle' }),
  'M-024': define<'M-024'>({ service: 'S-05', name: 'submitChangeResult', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-025': define<'M-025'>({ service: 'S-05', name: 'confirmChangeResolution', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-026': define<'M-026'>({ service: 'S-05', name: 'requestFurtherChange', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-027': define<'M-027'>({ service: 'S-05', name: 'assessGate', mode: 'query', scope: 'sr', visibility: 'public', guard: 'none' }),
  'M-028': define<'M-028'>({ service: 'S-05', name: 'transitionStage', mode: 'command', scope: 'sr', visibility: 'public', guard: 'transition' }),
  'M-029': define<'M-029'>({ service: 'S-06', name: 'createPolicyVersion', mode: 'command', scope: 'project', visibility: 'public', guard: 'none' }),
  'M-030': define<'M-030'>({ service: 'S-06', name: 'assignReviewers', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-031': define<'M-031'>({ service: 'S-06', name: 'applyPolicyToSr', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-032': define<'M-032'>({ service: 'S-07', name: 'requestGeneration', mode: 'command', scope: 'sr', visibility: 'public', guard: 'fingerprint' }),
  'M-033': define<'M-033'>({ service: 'S-07', name: 'getGeneration', mode: 'query', scope: 'sr', visibility: 'public', guard: 'none' }),
  'M-034': define<'M-034'>({ service: 'S-07', name: 'cancelGeneration', mode: 'command', scope: 'sr', visibility: 'public', guard: 'none' }),
  'M-035': define<'M-035'>({ service: 'S-07', name: 'retryGeneration', mode: 'command', scope: 'sr', visibility: 'public', guard: 'fingerprint' }),
  'M-036': define<'M-036'>({ service: 'S-07', name: 'claimRun', mode: 'internal', scope: 'runtime', visibility: 'internal', guard: 'none' }),
  'M-037': define<'M-037'>({ service: 'S-07', name: 'completeRun', mode: 'internal', scope: 'runtime', visibility: 'internal', guard: 'none' }),
  'M-038': define<'M-038'>({ service: 'S-07', name: 'failRun', mode: 'internal', scope: 'runtime', visibility: 'internal', guard: 'none' }),
  'M-039': define<'M-039'>({ service: 'S-07', name: 'reconcileInterruptedRuns', mode: 'internal', scope: 'runtime', visibility: 'internal', guard: 'none' }),
  'M-040': define<'M-040'>({ service: 'S-08', name: 'createHandoff', mode: 'command', scope: 'sr', visibility: 'public', guard: 'bundle' }),
  'M-041': define<'M-041'>({ service: 'S-08', name: 'previewHandoff', mode: 'query', scope: 'sr', visibility: 'public', guard: 'none' }),
  'M-042': define<'M-042'>({ service: 'S-08', name: 'exportCurrentHandoff', mode: 'command', scope: 'sr', visibility: 'public', guard: 'bundle' }),
  'M-043': define<'M-043'>({ service: 'S-08', name: 'recordImplementationStart', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision-and-bundle' }),
  'M-044': define<'M-044'>({ service: 'S-08', name: 'recordImplementationCompletion', mode: 'command', scope: 'sr', visibility: 'public', guard: 'revision' }),
  'M-045': define<'M-045'>({ service: 'S-09', name: 'getBoard', mode: 'query', scope: 'project', visibility: 'public', guard: 'none' }),
  'M-046': define<'M-046'>({ service: 'S-09', name: 'getInbox', mode: 'query', scope: 'project', visibility: 'public', guard: 'none' }),
  'M-047': define<'M-047'>({ service: 'S-09', name: 'getSrDetail', mode: 'query', scope: 'sr', visibility: 'public', guard: 'none' }),
  'M-048': define<'M-048'>({ service: 'S-09', name: 'getActivity', mode: 'query', scope: 'target', visibility: 'public', guard: 'none' }),
  'M-049': define<'M-049'>({ service: 'S-07', name: 'readRunControl', mode: 'internal', scope: 'runtime', visibility: 'internal', guard: 'none' }),
  'M-050': define<'M-050'>({ service: 'S-07', name: 'recordExecutionTermination', mode: 'internal', scope: 'runtime', visibility: 'internal', guard: 'none' }),
} as const satisfies Record<MethodId, MethodDefinition>;
