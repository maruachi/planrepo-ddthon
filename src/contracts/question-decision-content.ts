import type {
  ArtifactVersionRef,
  EntityRef,
  EvidenceRef,
  GateKind,
  IsoDateTime,
  QuestionAnswerVersionRef,
  QuestionResultSnapshotRef,
  ScopeClassificationRef,
  UserId,
  VersionRef,
  DecisionVersionRef,
} from './context';

export type QStoredEvidence =
  | { readonly text: string }
  | { readonly refs: readonly EvidenceRef[] };

interface CurrentScopeClassificationBase {
  readonly ref: ScopeClassificationRef;
  readonly targetRef: EntityRef<'question' | 'decision'>;
  readonly reason: string;
  readonly classifiedBy: UserId;
  readonly classifiedAt: IsoDateTime;
  readonly previousVersionRef?: ScopeClassificationRef;
  readonly basisRefs: readonly VersionRef[];
}

export type CurrentScopeClassificationContent =
  | (CurrentScopeClassificationBase & {
      readonly scope: 'current';
      readonly requiredGate: GateKind;
    })
  | (CurrentScopeClassificationBase & {
      readonly scope: 'followup';
      readonly requiredGate: 'None';
      readonly ownerId: UserId;
      readonly revisit:
        | { readonly kind: 'at'; readonly at: IsoDateTime }
        | { readonly kind: 'event'; readonly event: string };
    });

export interface QChoiceOption {
  readonly optionId: string;
  readonly text: string;
}

export type QAnswerContent =
  | { readonly kind: 'choice'; readonly optionId: string; readonly text: string }
  | { readonly kind: 'free_text'; readonly text: string };

export interface QSelectedAnswerContent {
  readonly ref: QuestionAnswerVersionRef;
  readonly answeredQuestionSnapshotRef: QuestionResultSnapshotRef;
  readonly answer: QAnswerContent;
  readonly evidence: QStoredEvidence;
  readonly answeredBy: UserId;
  readonly answeredAt: IsoDateTime;
}

export interface QResolutionContent {
  readonly selectedAnswerRef: QuestionAnswerVersionRef;
  readonly evidence: QStoredEvidence;
  readonly documentDisposition:
    | { readonly kind: 'reflected'; readonly artifactVersionRefs: readonly ArtifactVersionRef[] }
    | { readonly kind: 'not_required'; readonly reason: string };
  readonly resolvedBy: UserId;
  readonly resolvedAt: IsoDateTime;
}

export interface QCurrentResultContent {
  readonly ref: QuestionResultSnapshotRef;
  readonly capturedAt: IsoDateTime;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly selectedAnswer?: QSelectedAnswerContent;
  readonly resolution?: QResolutionContent;
}

export interface ProposalSourceContent {
  readonly draftId: string;
  readonly temporaryId: string;
}

export interface QContentFields {
  readonly text: string;
  readonly reason: string;
  readonly assigneeId: UserId;
  readonly answerMode: 'choice' | 'free_text';
  readonly options: readonly QChoiceOption[];
  readonly requiredGate: GateKind | 'None';
  readonly classificationRef: ScopeClassificationRef;
  readonly currentClassification: CurrentScopeClassificationContent;
  readonly parentQuestionId?: string;
  readonly candidateAnswers: readonly string[];
  readonly relatedArtifactRefs: readonly ArtifactVersionRef[];
  readonly sourceRefs: readonly VersionRef[];
  readonly dueAt?: IsoDateTime;
  readonly sourceDraft?: ProposalSourceContent;
  readonly convertedDecisionId?: string;
  readonly createdAt: IsoDateTime;
  readonly currentResult: QCurrentResultContent;
}

export interface DecisionAlternativeContent {
  readonly optionId: string;
  readonly label: string;
  readonly description: string;
}

export interface DecisionSelectionContent {
  readonly optionId?: string;
  readonly text: string;
}

export interface DecisionConfirmationContent {
  readonly ref: DecisionVersionRef;
  readonly selection: DecisionSelectionContent;
  readonly rationale: string;
  readonly evidence: QStoredEvidence;
  readonly decidedBy: UserId;
  readonly decidedAt: IsoDateTime;
  readonly classificationRef: ScopeClassificationRef;
  readonly originQuestionId?: string;
  readonly originQuestionResultSnapshotRef?: QuestionResultSnapshotRef;
  readonly previousVersionRef?: DecisionVersionRef;
  readonly changeReason?: string;
}

export interface DecisionContentFields {
  readonly prompt: string;
  readonly alternatives: readonly DecisionAlternativeContent[];
  readonly impact: string;
  readonly decisionMakerId: UserId;
  readonly requiredGate: GateKind | 'None';
  readonly classificationRef: ScopeClassificationRef;
  readonly currentClassification: CurrentScopeClassificationContent;
  readonly recommendation?: string;
  readonly sourceRefs: readonly VersionRef[];
  readonly originQuestionId?: string;
  readonly originQuestionResultSnapshotRef?: QuestionResultSnapshotRef;
  readonly sourceDraft?: ProposalSourceContent;
  readonly createdBy: UserId;
  readonly createdAt: IsoDateTime;
  readonly currentConfirmation?: DecisionConfirmationContent;
}
