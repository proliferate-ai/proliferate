// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReviewAssignmentDetail } from "@anyharness/sdk";
import { ReviewFeedbackSummaryView } from "./ReviewFeedbackSummary";

afterEach(cleanup);

describe("ReviewFeedbackSummaryView", () => {
  it("renders all-approved terminal results as a sentence receipt", () => {
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "architecture",
            personaLabel: "Architecture reviewer",
            pass: true,
            reviewerSessionId: "reviewer-session-architecture",
            sessionLinkId: "session-link-architecture",
          }),
          assignment({
            id: "risk",
            personaLabel: "Risk reviewer",
            pass: true,
            reviewerSessionId: "reviewer-session-risk",
            sessionLinkId: "session-link-risk",
          }),
        ]}
        reviewRunId="review-run"
        target="plan"
        onOpenCritique={vi.fn()}
      />,
    );

    expect(screen.getByTestId("review-terminal-receipt").textContent).toContain(
      "finished reviewing your plan.",
    );
    expect(screen.queryByText(/approved · plan/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Open review feedback details" })).toBeNull();
    expect(screen.queryByText("codex")).toBeNull();
    expect(screen.queryByText("gpt-5.4")).toBeNull();
  });

  it("renders mixed terminal results with concise counts", () => {
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "security",
            personaLabel: "Security reviewer",
            pass: true,
            summary: "Looks safe.",
            reviewerSessionId: "reviewer-session-security",
            sessionLinkId: "session-link-security",
          }),
          assignment({
            id: "ux",
            personaLabel: "UX reviewer",
            pass: false,
            summary: "Needs clearer approval copy.",
            reviewerSessionId: "reviewer-session-ux",
            sessionLinkId: "session-link-ux",
          }),
        ]}
        reviewRunId="review-run"
        target="PR"
        onOpenCritique={vi.fn()}
      />,
    );

    expect(screen.getByTestId("review-terminal-receipt").textContent).toContain(
      "finished reviewing your PR: 1 requested change, 1 approved.",
    );
    expect(screen.queryByText("Review feedback")).toBeNull();
  });

  it("renders cancelled terminal reviewers without treating them as still reviewing", () => {
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "security",
            personaLabel: "Security reviewer",
            pass: true,
            reviewerSessionId: "reviewer-session-security",
            sessionLinkId: "session-link-security",
          }),
          assignment({
            id: "offline",
            personaLabel: "Offline reviewer",
            pass: false,
            reviewerSessionId: null,
            sessionLinkId: "session-link-offline",
            status: "cancelled",
          }),
        ]}
        reviewRunId="review-run"
        target="PR"
        onOpenCritique={vi.fn()}
      />,
    );

    const receiptText = screen.getByTestId("review-terminal-receipt").textContent;
    expect(receiptText).toContain("finished reviewing your PR: 1 cancelled, 1 approved.");
    expect(receiptText).not.toContain("still reviewing");
  });

  it("opens reviewer sessions from reviewer-name links", () => {
    const onOpenReviewerSession = vi.fn();
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "ux",
            personaLabel: "UX reviewer",
            pass: false,
            reviewerSessionId: "reviewer-session-ux",
            sessionLinkId: "session-link-ux",
          }),
        ]}
        reviewRunId="review-run"
        target="PR"
        onOpenCritique={vi.fn()}
        onOpenReviewerSession={onOpenReviewerSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open .*UX reviewer/ }));
    expect(onOpenReviewerSession).toHaveBeenCalledWith("reviewer-session-ux");
  });

  it("renders reviewers without session ids as non-clickable colored text", () => {
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "offline",
            personaLabel: "Offline reviewer",
            pass: true,
            reviewerSessionId: null,
            sessionLinkId: "session-link-offline",
          }),
        ]}
        reviewRunId="review-run"
        target="PR"
        onOpenCritique={vi.fn()}
      />,
    );

    expect(screen.getByTestId("review-terminal-receipt").textContent).toContain(
      "finished reviewing your PR.",
    );
    expect(screen.queryByRole("button", { name: /Offline reviewer/ })).toBeNull();
  });

  it("keeps queued review feedback in the details-capable queue card", () => {
    const onOpenCritique = vi.fn();
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "ux",
            personaLabel: "UX reviewer",
            pass: false,
            summary: "Needs clearer approval copy.",
          }),
        ]}
        reviewRunId="review-run"
        state="queued"
        target="PR"
        onOpenCritique={onOpenCritique}
      />,
    );

    expect(screen.getByText("Review feedback")).toBeTruthy();
    expect(screen.getByText("1 reviewer · 1 requested change · PR")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open review feedback details" }));
    expect(screen.getByText("UX reviewer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open UX reviewer critique" }));
    expect(onOpenCritique).toHaveBeenCalledTimes(1);
  });

  it("shows cancelled queued reviewers as cancelled instead of reviewing", () => {
    render(
      <ReviewFeedbackSummaryView
        assignments={[
          assignment({
            id: "security",
            personaLabel: "Security reviewer",
            pass: true,
          }),
          assignment({
            id: "offline",
            personaLabel: "Offline reviewer",
            pass: false,
            status: "cancelled",
          }),
        ]}
        reviewRunId="review-run"
        state="queued"
        target="PR"
        onOpenCritique={vi.fn()}
      />,
    );

    expect(screen.getByText("2 reviewers · 1 cancelled · 1 approved · PR")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open review feedback details" }));
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText("Reviewing")).toBeNull();
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
