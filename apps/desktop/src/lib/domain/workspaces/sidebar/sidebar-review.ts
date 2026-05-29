interface WorkspaceNeedsReviewInput {
  isArchived: boolean;
  lastInteracted: string | null | undefined;
  lastViewedAt: string | null | undefined;
}

export function isWorkspaceNeedsReview({
  isArchived,
  lastInteracted,
  lastViewedAt,
}: WorkspaceNeedsReviewInput): boolean {
  if (isArchived || !lastInteracted) {
    return false;
  }

  return !lastViewedAt
    || new Date(lastInteracted).getTime() > new Date(lastViewedAt).getTime();
}
