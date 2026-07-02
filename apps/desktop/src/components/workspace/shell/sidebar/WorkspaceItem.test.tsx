// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkspaceGitStatus } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { WorkspaceItem } from "./WorkspaceItem";

vi.mock("@/lib/access/tauri/context-menu", () => ({
  canShowNativeContextMenu: () => false,
  showNativeContextMenu: vi.fn(),
}));

function makeGitStatus(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    branch: "feature/thing",
    dirty: false,
    conflicted: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    pr: {
      state: "open",
      number: 805,
      url: "https://github.com/acme/repo/pull/805",
      checks: "none",
      reviewDecision: "none",
    },
    attention: "none",
    capturedAt: "2026-07-01T10:00:00.000Z",
    source: "live",
    ...overrides,
  };
}

describe("WorkspaceItem", () => {

  afterEach(() => {
    cleanup();
  });

  it("keeps the delete workspace context menu open after right-clicking", async () => {
    const onSelect = vi.fn();

    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        onSelect={onSelect}
        onMarkDone={vi.fn()}
      />,
    );

    const row = screen.getByText("Feature worktree").closest('[role="button"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!, { clientX: 12, clientY: 12 });

    expect(await screen.findByRole("button", { name: "Delete workspace..." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not select the workspace when confirming delete from the context menu", () => {
    const onSelect = vi.fn();
    const onMarkDone = vi.fn();

    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        onSelect={onSelect}
        onMarkDone={onMarkDone}
      />,
    );

    const row = screen.getByText("Feature worktree").closest('[role="button"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!);
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace..." }));
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));

    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows workspace copy actions in the context menu", () => {
    const onCopyWorkspacePath = vi.fn();
    const onCopyBranchName = vi.fn();

    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        onSelect={vi.fn()}
        workspaceLocationCopyLabel="Copy workspace path"
        onCopyWorkspaceLocation={onCopyWorkspacePath}
        onCopyBranchName={onCopyBranchName}
      />,
    );

    const row = screen.getByText("Feature worktree").closest('[role="button"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!);
    fireEvent.click(screen.getByRole("button", { name: "Copy workspace pathCtrl+Shift+C" }));
    fireEvent.contextMenu(row!);
    fireEvent.click(screen.getByRole("button", { name: "Copy branch nameCtrl+Alt+C" }));

    expect(onCopyWorkspacePath).toHaveBeenCalledTimes(1);
    expect(onCopyBranchName).toHaveBeenCalledTimes(1);
  });

  it("shows the timestamp on active workspace rows", () => {
    render(
      <WorkspaceItem
        name="Fresh worktree"
        variant="worktree"
        active
        lastInteracted={new Date().toISOString()}
      />,
    );

    expect(screen.getByText("now")).toBeTruthy();
  });

  it("renders the PR status dot on the idle git glyph", () => {
    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        gitStatus={makeGitStatus()}
      />,
    );

    expect(screen.getByRole("img", { name: "PR #805 · Open" })).toBeTruthy();
  });

  it("lets an activity indicator own the leading well alone", () => {
    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        statusIndicator={{ kind: "iterating", tooltip: "Iterating" }}
        gitStatus={makeGitStatus()}
      />,
    );

    expect(screen.getByRole("img", { name: "Iterating" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "PR #805 · Open" })).toBeNull();
  });

  it("renders no PR dot for an authoritative no-PR branch", () => {
    const { container } = render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        gitStatus={makeGitStatus({
          pr: {
            state: "none",
            number: null,
            url: null,
            checks: "none",
            reviewDecision: "none",
          },
        })}
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    // The branch glyph still occupies the leading well.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("swaps the timestamp for the unread dot when the row needs review", () => {
    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        needsReview
        lastInteracted={new Date().toISOString()}
      />,
    );

    expect(screen.getByRole("img", { name: "Unseen activity" })).toBeTruthy();
    expect(screen.queryByText("now")).toBeNull();
  });

  it("opens the pull request from the context menu", () => {
    const onOpenPullRequest = vi.fn();

    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        onSelect={vi.fn()}
        gitStatus={makeGitStatus()}
        onOpenPullRequest={onOpenPullRequest}
      />,
    );

    const row = screen.getByText("Feature worktree").closest('[role="button"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!);
    fireEvent.click(screen.getByRole("button", { name: "Open pull request #805" }));

    expect(onOpenPullRequest).toHaveBeenCalledWith("https://github.com/acme/repo/pull/805");
  });
});
