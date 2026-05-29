import type { ReviewAssignmentDetail } from "@anyharness/sdk";

export const PLAYGROUND_REVIEW_FEEDBACK_ASSIGNMENTS: ReviewAssignmentDetail[] = [
  reviewAssignmentFixture({
    id: "security-reviewer",
    personaLabel: "Security reviewer",
    pass: true,
    summary: "No auth or data exposure regressions found.",
  }),
  reviewAssignmentFixture({
    id: "ux-reviewer",
    personaLabel: "UX reviewer",
    pass: false,
    summary: "Approval copy should not compete with the composer controls.",
  }),
  reviewAssignmentFixture({
    id: "integration-reviewer",
    personaLabel: "Integration reviewer",
    pass: false,
    summary: "Keep the review state derived from server runs.",
  }),
];

export const PLAYGROUND_REVIEW_COMPLETE_ASSIGNMENTS: ReviewAssignmentDetail[] = [
  reviewAssignmentFixture({
    id: "architecture-reviewer",
    personaLabel: "Architecture reviewer",
    pass: true,
    summary: "State ownership is clear.",
  }),
  reviewAssignmentFixture({
    id: "risk-reviewer",
    personaLabel: "Risk reviewer",
    pass: true,
    summary: "No blocking workflow risk found.",
  }),
  reviewAssignmentFixture({
    id: "product-reviewer",
    personaLabel: "Product reviewer",
    pass: true,
    summary: "The revised flow matches the requested behavior.",
  }),
];

function reviewAssignmentFixture(
  overrides: Partial<ReviewAssignmentDetail> & Pick<ReviewAssignmentDetail, "id" | "personaLabel">,
): ReviewAssignmentDetail {
  const { id, personaLabel, ...rest } = overrides;
  return {
    actualModeId: null,
    agentKind: "codex",
    createdAt: "2026-04-29T00:00:00Z",
    critiqueArtifactPath: null,
    deadlineAt: "2026-04-29T00:10:00Z",
    failureDetail: null,
    failureReason: null,
    hasCritique: true,
    id,
    modeVerificationStatus: "verified",
    modelId: "gpt-5.4",
    pass: true,
    personaId: id,
    personaLabel,
    requestedModeId: null,
    reviewRoundId: "review-round",
    reviewRunId: "review-run",
    reviewerSessionId: "reviewer-session",
    sessionLinkId: "session-link",
    status: "submitted",
    summary: null,
    updatedAt: "2026-04-29T00:05:00Z",
    ...rest,
  };
}
