export type WorktreeReviewStatus = 'requested' | 'approved' | 'changes_requested';

export interface WorktreeReviewView {
  id: string;
  srId: string;
  path: string;
  hash: string;
  body: string;
  requestComment: string;
  requestedAt: string;
  status: WorktreeReviewStatus;
  resultComment?: string;
  decidedAt?: string;
}
