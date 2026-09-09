import type { GateKind, GateValidity, ProgressStage } from '@/src/contracts/context';
import type { ReviewImpact } from '@/src/contracts/results';

export interface ReviewImpactGateInput {
  readonly gate: GateKind;
  readonly validity: GateValidity;
}

export interface DescriptionReviewImpactInput {
  readonly progressStage: ProgressStage;
  readonly gates: readonly ReviewImpactGateInput[];
  readonly blockingRequestIds: readonly string[];
}

export interface DescriptionReviewImpactDecision {
  readonly reviewImpact: ReviewImpact;
  readonly progressStage: ProgressStage;
}

export type ContextSourceReviewBasis = {
  readonly provenance: string;
  readonly confirmation: 'unconfirmed' | 'confirmed';
  readonly displayName?: string;
  readonly confirmedBy?: string;
  readonly confirmedAt?: string;
  readonly confirmationEvidence?: string;
} & (
  | { readonly kind: 'text' | 'markdown'; readonly content: string }
  | {
      readonly kind: 'link';
      readonly targetUrl: string;
      readonly verifiable: boolean;
      readonly observedExternalVersion?: string;
      readonly unavailableReason?: string;
    }
);

export interface ContextSourceReviewImpactInput extends DescriptionReviewImpactInput {
  readonly before?: ContextSourceReviewBasis;
  readonly after: ContextSourceReviewBasis;
}

export interface VersionReviewImpactInput extends DescriptionReviewImpactInput {
  readonly affectedGates: readonly GateKind[];
}

export function assessVersionReviewImpact(
  input: VersionReviewImpactInput,
): DescriptionReviewImpactDecision {
  const unique = new Set(input.affectedGates);
  if (unique.size !== input.affectedGates.length) {
    throw new Error('영향 gate가 중복됐습니다.');
  }
  const affectsG1 = unique.has('G1');
  const affectsG2 = unique.has('G2');
  if (affectsG1 && !affectsG2) {
    throw new Error('G1 영향은 종속 G2를 포함해야 합니다.');
  }
  if (input.affectedGates.length === 0) {
    return {
      reviewImpact: {
        affectedGates: [],
        needsNewReview: false,
        carriedBlockingRequestIds: [],
        currentHandoffValid: !input.gates.some((gate) => gate.validity === 'invalid'),
      },
      progressStage: input.progressStage,
    };
  }
  if (!affectsG2 || input.affectedGates.some((gate) => gate !== 'G1' && gate !== 'G2')) {
    throw new Error('영향 gate 구성이 올바르지 않습니다.');
  }
  const returnStage: ProgressStage = affectsG1 ? 'requirements' : 'planning';
  const stages: readonly ProgressStage[] = [
    'sr_received', 'requirements', 'planning', 'ready', 'implementing', 'completed',
  ];
  const currentIndex = stages.indexOf(input.progressStage);
  const returnIndex = stages.indexOf(returnStage);
  const progressStage = currentIndex <= returnIndex ? input.progressStage : returnStage;
  return {
    reviewImpact: {
      affectedGates: affectsG1 ? ['G1', 'G2'] : ['G2'],
      needsNewReview: true,
      returnStage: progressStage,
      carriedBlockingRequestIds: [...input.blockingRequestIds],
      currentHandoffValid: false,
    },
    progressStage,
  };
}

function changedDecision(
  input: DescriptionReviewImpactInput,
): DescriptionReviewImpactDecision {
  const affectedGates: readonly GateKind[] = ['G1', 'G2'];
  const hadApprovedBasis = input.gates.some((gate) => gate.validity !== 'not_passed');
  return {
    reviewImpact: {
      affectedGates,
      needsNewReview: true,
      returnStage: 'requirements',
      carriedBlockingRequestIds: [...input.blockingRequestIds],
      currentHandoffValid: false,
    },
    progressStage:
      input.progressStage === 'sr_received' && !hadApprovedBasis
        ? 'sr_received'
        : 'requirements',
  };
}

function materialSource(source: ContextSourceReviewBasis): unknown {
  const confirmation = source.confirmation === 'confirmed'
    ? {
        confirmation: source.confirmation,
        confirmedBy: source.confirmedBy,
        confirmedAt: source.confirmedAt,
        confirmationEvidence: source.confirmationEvidence,
      }
    : { confirmation: source.confirmation };
  return source.kind === 'link'
    ? {
        kind: source.kind,
        targetUrl: source.targetUrl,
        provenance: source.provenance,
        verifiable: source.verifiable,
        observedExternalVersion: source.observedExternalVersion,
        unavailableReason: source.unavailableReason,
        ...confirmation,
      }
    : {
        kind: source.kind,
        content: source.content,
        provenance: source.provenance,
        ...confirmation,
      };
}

export function assessDescriptionReviewImpact(
  input: DescriptionReviewImpactInput,
): DescriptionReviewImpactDecision {
  return changedDecision(input);
}

export function assessContextSourceReviewImpact(
  input: ContextSourceReviewImpactInput,
): DescriptionReviewImpactDecision {
  if (
    input.before !== undefined &&
    JSON.stringify(materialSource(input.before)) === JSON.stringify(materialSource(input.after))
  ) {
    return {
      reviewImpact: {
        affectedGates: [],
        needsNewReview: false,
        carriedBlockingRequestIds: [],
        currentHandoffValid: true,
      },
      progressStage: input.progressStage,
    };
  }
  return changedDecision(input);
}
