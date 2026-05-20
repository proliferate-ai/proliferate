// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedReviewCritiqueDialog } from "./ConnectedReviewCritiqueDialog";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const sdkReactMocks = vi.hoisted(() => ({
  useReviewAssignmentCritiqueQuery: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useReviewAssignmentCritiqueQuery: sdkReactMocks.useReviewAssignmentCritiqueQuery,
}));

beforeEach(() => {
  sdkReactMocks.useReviewAssignmentCritiqueQuery.mockReturnValue({
    data: {
      critiqueMarkdown: [
        "## Findings",
        "",
        "- `desktop/src/App.tsx` needs a guard.",
      ].join("\n"),
    },
    error: null,
    isLoading: false,
  });
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: "workspace-1",
    workspaceId: "workspace-1",
  });
  useReviewUiStore.getState().openCritique({
    reviewRunId: "review-run",
    assignmentId: "assignment-1",
    personaLabel: "Security reviewer",
  });
});

afterEach(() => {
  cleanup();
  useReviewUiStore.getState().closeCritique();
  useSessionSelectionStore.getState().clearSelection();
  vi.clearAllMocks();
});

describe("ConnectedReviewCritiqueDialog", () => {
  it("renders critiqueMarkdown as formatted Markdown", () => {
    render(<ConnectedReviewCritiqueDialog />);

    expect(screen.getByRole("dialog", { name: "Security reviewer" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Findings" }).tagName).toBe("H2");
    expect(screen.getByRole("listitem").textContent).toContain(
      "desktop/src/App.tsx",
    );
    expect(document.querySelector("pre")).toBeNull();
    expect(sdkReactMocks.useReviewAssignmentCritiqueQuery).toHaveBeenCalledWith(
      "review-run",
      "assignment-1",
      {
        workspaceId: "workspace-1",
        enabled: true,
      },
    );
  });

  it("shows an empty state when no critique body was submitted", () => {
    sdkReactMocks.useReviewAssignmentCritiqueQuery.mockReturnValue({
      data: { critiqueMarkdown: "  " },
      error: null,
      isLoading: false,
    });

    render(<ConnectedReviewCritiqueDialog />);

    expect(screen.getByText("No critique body was submitted.")).toBeTruthy();
    expect(document.querySelector("pre")).toBeNull();
  });
});
