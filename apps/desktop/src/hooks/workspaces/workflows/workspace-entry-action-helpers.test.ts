import type { Workspace } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";

import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import { buildMaterializedWorktreePendingEntry } from "./workspace-entry-action-helpers";

const baseEntry: PendingWorkspaceEntry = {
  attemptId: "attempt-1",
  source: "worktree-created",
  stage: "submitting",
  displayName: "otter",
  repoLabel: "proliferate",
  baseBranchName: "main",
  workspaceId: null,
  request: {
    kind: "worktree",
    input: {
      repoRootId: "repo-root-1",
      workspaceName: "otter",
      branchName: "pablo/otter",
      baseBranch: "main",
      targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/otter",
    },
    retryInput: {
      repoRootId: "repo-root-1",
      workspaceName: "otter",
      baseBranch: "main",
      defaultBranch: "main",
      generatedName: true,
    },
  },
  originTarget: { kind: "home" },
  errorMessage: null,
  setupScript: null,
  createdAt: 1,
};

describe("workspace entry action helpers", () => {
  it("preserves requested base branch when AnyHarness reports the created branch as originalBranch", () => {
    const entry = buildMaterializedWorktreePendingEntry({
      entry: baseEntry,
      resolvedInput: baseEntry.request.kind === "worktree"
        ? baseEntry.request.input
        : { repoRootId: "repo-root-1" },
      workspace: worktreeWorkspace({
        path: "/Users/pablo/.proliferate/worktrees/proliferate/otter-2",
        currentBranch: "pablo/otter-2",
        originalBranch: "pablo/otter-2",
      }),
      fallbackBranchName: "pablo/otter",
      fallbackBaseRef: "main",
      setupScript: null,
    });

    expect(entry.displayName).toBe("otter-2");
    expect(entry.baseBranchName).toBe("main");
    expect(entry.request).toMatchObject({
      kind: "worktree",
      input: {
        workspaceName: "otter-2",
        branchName: "pablo/otter-2",
        baseBranch: "main",
        targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/otter-2",
      },
      retryInput: {
        workspaceName: "otter",
        baseBranch: "main",
        defaultBranch: "main",
        generatedName: true,
      },
    });
  });

  it("uses the selected base ref as the visible branch for detached worktrees", () => {
    const entry = buildMaterializedWorktreePendingEntry({
      entry: baseEntry,
      resolvedInput: baseEntry.request.kind === "worktree"
        ? baseEntry.request.input
        : { repoRootId: "repo-root-1" },
      workspace: worktreeWorkspace({
        path: "/Users/pablo/.proliferate/worktrees/proliferate/otter",
        currentBranch: null,
        originalBranch: "feature/base",
      }),
      fallbackBranchName: "pablo/otter",
      fallbackBaseRef: "feature/base",
      setupScript: null,
    });

    expect(entry.baseBranchName).toBe("feature/base");
    expect(entry.request).toMatchObject({
      kind: "worktree",
      input: {
        workspaceName: "otter",
        branchName: "feature/base",
        baseBranch: "feature/base",
      },
    });
  });
});

function worktreeWorkspace(input: {
  path: string;
  currentBranch: string | null;
  originalBranch: string | null;
}): Workspace {
  return {
    id: "workspace-created",
    kind: "worktree",
    repoRootId: "repo-root-1",
    path: input.path,
    surface: "standard",
    originalBranch: input.originalBranch,
    currentBranch: input.currentBranch,
    displayName: null,
    origin: null,
    creatorContext: null,
    lifecycleState: "active",
    cleanupState: "none",
    cleanupOperation: null,
    cleanupErrorMessage: null,
    cleanupFailedAt: null,
    cleanupAttemptedAt: null,
    executionSummary: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Workspace;
}
