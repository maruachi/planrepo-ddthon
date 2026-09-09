export function canApplyChange(input: {
  readonly actorId: string;
  readonly assigneeId: string;
  readonly srOwnerId: string;
}): boolean {
  return input.actorId === input.assigneeId || input.actorId === input.srOwnerId;
}

export function canReviewChange(input: {
  readonly actorId: string;
  readonly requesterId: string;
  readonly currentReviewerIds: readonly string[];
}): boolean {
  return input.actorId === input.requesterId || input.currentReviewerIds.includes(input.actorId);
}
