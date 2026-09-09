import type { GateAssessment } from '@/src/contracts/results';

export type ReviewState = GateAssessment['reviewState'];

export function reviewState(input: {
  readonly needsNewBundle: boolean;
  readonly hasCurrentBundle: boolean;
  readonly hasBlockingChange: boolean;
  readonly reviewerCount: number;
  readonly approvedReviewerCount: number;
  readonly hasReviewAction: boolean;
}): ReviewState {
  if (input.needsNewBundle && input.hasCurrentBundle) return '재검토 필요';
  if (!input.hasCurrentBundle) return '작성 중';
  if (input.hasBlockingChange) return '수정 필요';
  if (input.reviewerCount > 0 && input.approvedReviewerCount === input.reviewerCount) return '승인 완료';
  if (input.hasReviewAction) return '검토 중';
  return '검토 요청';
}
