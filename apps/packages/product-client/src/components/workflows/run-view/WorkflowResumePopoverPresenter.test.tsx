// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { WorkflowResumePopoverPresenter } from "#product/components/workflows/run-view/WorkflowResumePopoverPresenter";

const deps = vi.hoisted(() => ({
  interruptedRuns: [] as WorkflowRunV2[],
  dismiss: vi.fn(),
  resumeAndOpen: vi.fn(),
}));

vi.mock("#product/hooks/workflows/lifecycle/use-workflow-resume-popover", () => ({
  useWorkflowResumePopover: () => ({
    interruptedRuns: deps.interruptedRuns,
    dismiss: deps.dismiss,
    resumeAndOpen: deps.resumeAndOpen,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({ logicalWorkspaces: [] }),
}));

function buildRun(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: JSON.stringify({ title: "Nightly migration" }),
    argumentsJson: "{}",
    workspaceId: "workspace-1",
    status: "interrupted",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("WorkflowResumePopoverPresenter", () => {
  beforeEach(() => {
    deps.interruptedRuns = [buildRun()];
    deps.dismiss.mockReset();
    deps.resumeAndOpen.mockReset();
  });

  afterEach(() => {
    // Explicit: this lane does not run vitest `globals`, so testing-library's
    // auto-cleanup never registers — and this presenter renders through a
    // portal, so an uncleaned tree leaves its rows in `document.body`.
    cleanup();
    vi.clearAllMocks();
  });

  it("renders nothing when no run is interrupted", () => {
    deps.interruptedRuns = [];

    const { container } = render(<WorkflowResumePopoverPresenter />);

    expect(container.firstChild).toBeNull();
  });

  it("anchors into the corner opposite the toaster", () => {
    const { container } = render(<WorkflowResumePopoverPresenter />);

    // The `Toaster` is pinned `position="bottom-right"` (`Sonner.tsx`) and this
    // feature's own resume-failed toast lands there, so the nudge card must not.
    const anchor = container.querySelector('span[aria-hidden="true"]');
    expect(anchor?.className).toContain("bottom-4");
    expect(anchor?.className).toContain("left-4");
    expect(anchor?.className).not.toContain("right-4");
  });

  it("gives each row's controls a sanctioned Button size with no height override", () => {
    render(<WorkflowResumePopoverPresenter />);

    for (const name of ["Resume", "Dismiss"]) {
      const control = screen.getByRole("button", { name });
      // `size="sm"` is `h-8`; an `h-7` here would be a seventh height on the
      // scale with no recorded cause.
      expect(control.className).toContain("h-8");
      expect(control.className).not.toMatch(/(^|\s)h-7(\s|$)/);
    }
  });

  it("routes each row's controls at the run they belong to", () => {
    deps.interruptedRuns = [
      buildRun({ id: "run-a", definitionJson: JSON.stringify({ title: "Older run" }) }),
      buildRun({
        id: "run-b",
        updatedAt: "2026-08-02T00:00:00.000Z",
        definitionJson: JSON.stringify({ title: "Newer run" }),
      }),
    ];

    render(<WorkflowResumePopoverPresenter />);

    // Freshest first, so the first Resume belongs to `run-b`.
    expect(screen.getAllByRole("button", { name: "Resume" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Resume" })[0]!);
    expect(deps.resumeAndOpen).toHaveBeenCalledWith("run-b");

    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]!);
    expect(deps.dismiss).toHaveBeenCalledWith("run-a");
  });

  it("names the run and its interruption on the row", () => {
    render(<WorkflowResumePopoverPresenter />);

    expect(screen.getByText("Nightly migration")).not.toBeNull();
    expect(screen.getByText(/^Interrupted /)).not.toBeNull();
  });
});
