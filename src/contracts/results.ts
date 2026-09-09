import type {
  ActorContext,
  BundleRef,
  EntityRef,
  Fingerprint,
  GateKind,
  GateValidity,
  IsoDateTime,
  ReceiptId,
  Revision,
  ReviewEpoch,
  TargetScope,
  UserId,
  VersionRef,
} from './context';

export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'NOT_ASSIGNED'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'STALE_BUNDLE'
  | 'INPUT_CHANGED'
  | 'QUEUE_FULL'
  | 'GATE_BLOCKED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STORE_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_OUTPUT'
  | 'RUN_FINAL';

export interface CurrentBasis {
  readonly target: EntityRef;
  readonly currentRevision?: Revision;
  readonly currentBundleRef?: BundleRef;
  readonly reviewEpoch?: ReviewEpoch;
  readonly inputFingerprint?: Fingerprint;
  readonly validity?: GateValidity;
  readonly allowedActions: readonly string[];
}

export interface DomainBlocker {
  readonly code: string;
  readonly reason: string;
  readonly assigneeIds: readonly UserId[];
  readonly targetRefs: readonly EntityRef[];
}

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly current?: CurrentBasis;
  readonly blockers: readonly DomainBlocker[];
  readonly assigneeIds: readonly UserId[];
  readonly targetRefs: readonly EntityRef[];
}

export type ReceiptResultRef = EntityRef | VersionRef | BundleRef;

export interface CommandReceipt {
  readonly scope: TargetScope;
  readonly receiptId: ReceiptId;
  readonly actorRef: Pick<ActorContext, 'actorId' | 'projectId'>;
  readonly commandKind: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: Fingerprint;
  readonly committedRevision: Revision;
  readonly resultRefs: readonly ReceiptResultRef[];
  readonly committedAt: IsoDateTime;
}

export type CommandResult<T> =
  | { readonly kind: 'Committed'; readonly value: T; readonly receipt: CommandReceipt }
  | {
      readonly kind: 'Replayed';
      readonly value: T;
      readonly receipt: CommandReceipt;
      readonly current: CurrentBasis;
    }
  | { readonly kind: 'Rejected'; readonly error: DomainError; readonly priorReceipt?: CommandReceipt };

export interface ReviewImpact {
  readonly affectedGates: readonly GateKind[];
  readonly needsNewReview: boolean;
  readonly returnStage?: string;
  readonly carriedBlockingRequestIds: readonly string[];
  readonly currentHandoffValid: boolean;
}

export interface GateConditionResult {
  readonly conditionId: string;
  readonly passed: boolean;
  readonly reason: string;
  readonly assigneeIds: readonly UserId[];
  readonly targetRefs: readonly EntityRef[];
}

export interface GateAssessment {
  readonly gate: GateKind;
  readonly assessedRevision: Revision;
  readonly reviewEpoch: ReviewEpoch;
  readonly currentBundleRef?: BundleRef;
  readonly g1BundleRef?: BundleRef;
  readonly conditions: readonly GateConditionResult[];
  readonly reviewState: '재검토 필요' | '작성 중' | '수정 필요' | '승인 완료' | '검토 중' | '검토 요청';
  readonly canTransition: boolean;
}

export interface MarkdownDownload {
  readonly handoffId: string;
  readonly filename: string;
  readonly contentType: 'text/markdown; charset=utf-8';
  readonly bytes: Uint8Array;
}

export interface VersionChangeSummary {
  readonly previous?: VersionRef;
  readonly current: VersionRef;
  readonly reviewImpact: ReviewImpact;
}
