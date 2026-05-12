// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GitStatusSnapshot } from "@anyharness/sdk";
import { GitActionsButton } from "./GitActionsButton";

afterEach(() => {
  cleanup();
});

describe("GitActionsButton", () => {
  it("shows a disabled publish action while git status is loading", () => {
    renderButton({ gitStatus: null });

    expect((screen.getByRole("button", { name: /publish branch/i }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("keeps the publish label when git actions are temporarily disabled", () => {
    renderButton({
      gitStatus: gitStatus({
        clean: true,
        actions: {
          canCommit: false,
          canCreateBranchWorkspace: false,
          canCreateDraftPullRequest: false,
          canPush: true,
          canCreatePullRequest: false,
          pushLabel: "Publish branch",
        },
      }),
      disabled: true,
    });

    expect((screen.getByRole("button", { name: /publish branch/i }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});

function renderButton({
  gitStatus,
  disabled = false,
}: {
  gitStatus: GitStatusSnapshot | null;
  disabled?: boolean;
}) {
  render(
    <GitActionsButton
      gitStatus={gitStatus}
      existingPr={null}
      disabled={disabled}
      onCommit={vi.fn()}
      onPush={vi.fn()}
      onCreatePr={vi.fn()}
      onViewPr={vi.fn()}
    />,
  );
}

function gitStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    clean: true,
    files: [],
    currentBranch: "feature/demo",
    upstreamBranch: null,
    ahead: 0,
    behind: 0,
    detached: false,
    conflicted: false,
    actions: {
      canCommit: false,
      canCreateBranchWorkspace: false,
      canCreateDraftPullRequest: false,
      canPush: false,
      canCreatePullRequest: false,
      pushLabel: "Push",
    },
    ...overrides,
  } as GitStatusSnapshot;
}
