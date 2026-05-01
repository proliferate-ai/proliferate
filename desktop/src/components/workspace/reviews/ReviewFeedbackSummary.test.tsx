// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReviewAssignmentDetail } from "@anyharness/sdk";
import { ReviewFeedbackSummaryView } from "./ReviewFeedbackSummary";

afterEach(cleanup);

describe("ReviewFeedbackSummaryView", () => {
  it("renders a collapsed receipt before details are requested", () => {
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "security",
            personaLabel: "Security reviewer",
            pass: true,
            summary: "Looks safe.",
          }),
          assignment({
            id: "ux",
            personaLabel: "UX reviewer",
            pass: false,
            summary: "Needs clearer approval copy.",
          }),
        ]}
        reviewRunId="review-run"
        target="PR"
        onOpenCritique={vi.fn()}
      />,
    );

    expect(screen.getByText("Review feedback")).toBeTruthy();
    expect(screen.getByText("2 reviewers · 1 requested change · 1 approved · PR")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open review feedback details" })).toBeTruthy();
    expect(screen.queryByText("Security reviewer")).toBeNull();
    expect(screen.queryByText("UX reviewer")).toBeNull();
    expect(screen.queryByText("codex")).toBeNull();
    expect(screen.queryByText("gpt-5.4")).toBeNull();
  });

  it("opens reviewer rows in the details popover", () => {
    const onOpenCritique = vi.fn();
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "security",
            personaLabel: "Security reviewer",
            pass: true,
            summary: "Looks safe.",
          }),
          assignment({
            id: "ux",
            personaLabel: "UX reviewer",
            pass: false,
            summary: "Needs clearer approval copy.",
          }),
        ]}
        reviewRunId="review-run"
        target="PR"
        onOpenCritique={onOpenCritique}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open review feedback details" }));

    expect(screen.getByText("Security reviewer")).toBeTruthy();
    expect(screen.getByText("UX reviewer")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Requests changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open UX reviewer critique" }));
    expect(onOpenCritique).toHaveBeenCalledTimes(1);
  });

  it("summarizes fully approved reviews as complete", () => {
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({ id: "architecture", personaLabel: "Architecture reviewer", pass: true }),
          assignment({ id: "risk", personaLabel: "Risk reviewer", pass: true }),
        ]}
        reviewRunId="review-run"
        target="plan"
        onOpenCritique={vi.fn()}
      />,
    );

    expect(screen.getByText("Review complete")).toBeTruthy();
    expect(screen.getByText("2 reviewers approved · plan")).toBeTruthy();
  });
});

function assignment(
  overrides: Partial<ReviewAssignmentDetail> & Pick<ReviewAssignmentDetail, "id" | "personaLabel">,
): ReviewAssignmentDetail {
  return {
    actualModeId: null,
    agentKind: "codex",
    createdAt: "2026-04-29T00:00:00Z",
    critiqueArtifactPath: null,
    deadlineAt: "2026-04-29T00:10:00Z",
    failureDetail: null,
    failureReason: null,
    hasCritique: true,
    modeVerificationStatus: "verified",
    modelId: "gpt-5.4",
    pass: true,
    personaId: overrides.id,
    requestedModeId: null,
    reviewRoundId: "review-round",
    reviewRunId: "review-run",
    reviewerSessionId: "reviewer-session",
    sessionLinkId: "session-link",
    status: "submitted",
    summary: null,
    updatedAt: "2026-04-29T00:05:00Z",
    ...overrides,
  };
}
