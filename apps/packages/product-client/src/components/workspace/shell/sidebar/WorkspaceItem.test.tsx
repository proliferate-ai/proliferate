// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import { WorkspaceItem } from "#product/components/workspace/shell/sidebar/WorkspaceItem";

const webTestHost = { desktop: null } as ProductHost;

function renderWithProductHost(ui: ReactElement) {
  return render(
    <ProductHostProvider host={webTestHost}>{ui}</ProductHostProvider>,
  );
}

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

    renderWithProductHost(
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

    renderWithProductHost(
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

    renderWithProductHost(
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

  it("renders PR status as the left identity glyph", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        gitStatus={makeGitStatus()}
      />,
    );

    expect(screen.getByRole("img", { name: "PR #805 · Open" })).toBeTruthy();
  });

  it("renders PR identity and activity together in the two trailing cells", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        statusIndicator={{ kind: "iterating", tooltip: "Iterating" }}
        gitStatus={makeGitStatus()}
      />,
    );

    expect(screen.getByRole("img", { name: "Iterating" })).toBeTruthy();
    // Live activity does not evict the PR identity cell.
    expect(screen.getByRole("img", { name: "PR #805 · Open" })).toBeTruthy();
    const cells = screen.getByRole("img", { name: "PR #805 · Open" })
      .closest("[data-sidebar-trailing-cells]");
    expect(cells?.children).toHaveLength(2);
  });

  it("falls back to worktree identity for an authoritative no-PR branch", () => {
    renderWithProductHost(
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

    expect(screen.getByRole("img", { name: "Worktree" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "No pull request" })).toBeNull();
  });

  it("falls back to worktree identity when PR data is unknown", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        gitStatus={makeGitStatus({ pr: null })}
      />,
    );

    expect(screen.getByRole("img", { name: "Worktree" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Pull request status unavailable" })).toBeNull();
  });

  it("shows worktree identity before git status loads", () => {
    renderWithProductHost(
      <WorkspaceItem name="Pending worktree" variant="worktree" />,
    );

    expect(screen.getByRole("img", { name: "Worktree" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Pull request status unavailable" })).toBeNull();
  });

  it("keeps git attention beside the worktree fallback when there is no PR", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Conflicted worktree"
        variant="worktree"
        gitStatus={makeGitStatus({
          pr: {
            state: "none",
            number: null,
            url: null,
            checks: "none",
            reviewDecision: "none",
          },
          attention: "conflicts",
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Worktree" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Merge conflicts in worktree" })).toBeTruthy();
  });

  it("keeps the PR identity in place for cloud workspaces", () => {
    renderWithProductHost(
      <WorkspaceItem name="Cloud workspace" variant="cloud" />,
    );

    expect(screen.getByRole("img", { name: "Pull request status unavailable" })).toBeTruthy();
  });

  it("shows git attention beside the PR identity", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        gitStatus={makeGitStatus({ attention: "changes_requested" })}
      />,
    );

    expect(screen.getByRole("img", { name: "PR #805 · Open" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Pull request changes requested" }))
      .toBeTruthy();
  });

  it("shows the unread dot in the right slot when the row needs review", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        needsReview
      />,
    );

    expect(screen.getByRole("img", { name: "Unseen activity" })).toBeTruthy();
  });

  it("lets an activity indicator beat the unread dot in the right slot", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        needsReview
        statusIndicator={{ kind: "iterating", tooltip: "Iterating" }}
      />,
    );

    expect(screen.getByRole("img", { name: "Iterating" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Unseen activity" })).toBeNull();
  });

  it("opens the pull request from the context menu", () => {
    const onOpenPullRequest = vi.fn();

    renderWithProductHost(
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
