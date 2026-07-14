// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import type { WorkspaceGitStatus } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { WorkspaceItem } from "./WorkspaceItem";

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

  it("renders PR status as a compact git detail glyph", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        gitStatus={makeGitStatus()}
      />,
    );

    expect(screen.getByRole("img", { name: "PR #805 · Open" })).toBeTruthy();
  });

  it("renders activity and PR state together in the right-side details", () => {
    renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        statusIndicator={{ kind: "iterating", tooltip: "Iterating" }}
        gitStatus={makeGitStatus()}
      />,
    );

    expect(screen.getByRole("img", { name: "Iterating" })).toBeTruthy();
    // Live activity does not evict the compact PR detail glyph.
    expect(screen.getByRole("img", { name: "PR #805 · Open" })).toBeTruthy();
  });

  it("renders no git glyph for an authoritative no-PR branch", () => {
    const { container } = renderWithProductHost(
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
    // No branch-glyph fallback is shown without a PR.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders no git glyph when PR data is unknown", () => {
    const { container } = renderWithProductHost(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        gitStatus={makeGitStatus({ pr: null })}
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
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
