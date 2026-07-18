// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeMissingAttachedPanel } from "#product/components/workspace/chat/surface/WorktreeMissingAttachedPanel";

const mocks = vi.hoisted(() => ({
  actions: {
    checkAgain: vi.fn(async () => undefined),
    isCheckingAgain: false,
    restoreWorktree: vi.fn(async () => true),
    isRestoring: false,
    restoreError: null as string | null,
    deleteWorkspace: vi.fn(async () => true),
    isDeleting: false,
  },
}));

vi.mock("#product/hooks/workspaces/workflows/use-worktree-missing-actions", () => ({
  useWorktreeMissingActions: () => mocks.actions,
}));

beforeEach(() => {
  mocks.actions.isCheckingAgain = false;
  mocks.actions.isRestoring = false;
  mocks.actions.restoreError = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorktreeMissingAttachedPanel", () => {
  it("presents restore as the primary worktree action with secondary recovery actions", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Restore worktree" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete workspace…" })).toBeTruthy();
    expect(screen.getByText(/deleted uncommitted changes cannot be recovered/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore worktree" }));
    expect(mocks.actions.restoreWorktree).toHaveBeenCalledTimes(1);
  });

  it("does not offer restore for an ineligible plain workspace", () => {
    renderPanel({ workspaceKind: "local", restoreEligible: false });

    expect(screen.queryByRole("button", { name: "Restore worktree" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete workspace…" })).toBeNull();
  });

  it("renders restore progress and disables competing actions", () => {
    mocks.actions.isRestoring = true;
    renderPanel();

    expect((screen.getByRole("button", { name: "Restoring…" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(
      (screen.getByRole("button", { name: "Delete workspace…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps typed restore failures visible and actionable", () => {
    mocks.actions.restoreError =
      "Something now exists at the recorded worktree path. Move it elsewhere, then check again; Proliferate will not overwrite it.";
    renderPanel();

    expect(screen.getByRole("alert").textContent).toMatch(/will not overwrite it/i);
    expect(screen.getByRole("button", { name: "Restore worktree" })).toBeTruthy();
  });
});

function renderPanel(overrides?: {
  workspaceKind?: "local" | "worktree";
  restoreEligible?: boolean;
}) {
  return render(
    <WorktreeMissingAttachedPanel
      workspaceId="workspace-1"
      logicalWorkspaceId="logical-1"
      workspaceKind={overrides?.workspaceKind ?? "worktree"}
      workspacePath="/repos/project/worktrees/feature"
      originalBranch="feature/restore"
      restoreEligible={overrides?.restoreEligible ?? true}
    />,
  );
}
