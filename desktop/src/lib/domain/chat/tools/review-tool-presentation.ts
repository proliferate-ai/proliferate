export function formatReviewMcpActionLabel(action: string): string | null {
  switch (action) {
    case "submit_review_result":
      return "Submit review result";
    case "get_review_status":
      return "Get review status";
    case "mark_review_revision_ready":
      return "Mark revision ready";
    default:
      return null;
  }
}
