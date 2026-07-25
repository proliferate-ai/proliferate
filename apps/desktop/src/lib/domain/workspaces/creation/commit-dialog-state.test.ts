import { describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatusSnapshot } from "@anyharness/sdk";
import {
  deriveCommitDialogState,
  validateCommitAction,
  validatePrCreation,
} from "./commit-dialog-state";

function file(path: string, includedState: GitChangedFile["includedState"]): GitChangedFile {
  return {
    path,
    oldPath: undefined,
    status: "modified",
    additions: 5,
    deletions: 2,
    binary: false,
    includedState,
  };
}

function status(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    workspaceId: "workspace-1",
    workspacePath: "/repo",
    repoRootPath: "/repo",
    currentBranch: "feature/demo",
    headOid: "abc",
    detached: false,
    upstreamBranch: "origin/feature/demo",
    suggestedBaseBranch: "main",
    ahead: 0,
    behind: 0,
    operation: "none",
    conflicted: false,
    clean: false,
    summary: {
      changedFiles: 1,
      additions: 5,
      deletions: 2,
      includedFiles: 1,
      conflictedFiles: 0,
    },
    actions: {
      canCommit: true,
      canPush: false,
      pushLabel: "Push",
      canCreatePullRequest: false,
      canCreateDraftPullRequest: false,
      canCreateBranchWorkspace: true,
      reasonIfBlocked: undefined,
    },
    files: [file("src/app.ts", "included")],
    ...overrides,
  };
}

describe("deriveCommitDialogState", () => {
  it("dirty tree: all four actions available", () => {
    const result = deriveCommitDialogState(
      { gitStatus: status(), existingPr: null, runtimeBlockedReason: null },
      null,
    );
    expect(result.dialogMode).toBe("dirty");
    expect(result.hasDirtyTree).toBe(true);
    expect(result.availableActions).toEqual([
      "commit",
      "commit_and_push",
      "push",
      "create_pr",
    ]);
    expect(result.totalAdditions).toBe(5);
    expect(result.totalDeletions).toBe(2);
  });

  it("clean tree with unpushed commits: only push and create_pr", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({
          clean: true,
          ahead: 2,
          files: [],
          actions: { ...status().actions, canPush: true },
        }),
        existingPr: null,
        runtimeBlockedReason: null,
      },
      null,
    );
    expect(result.dialogMode).toBe("unpushed");
    expect(result.hasDirtyTree).toBe(false);
    expect(result.hasUnpushedCommits).toBe(true);
    expect(result.availableActions).toEqual(["push", "create_pr"]);
  });

  it("synced with no PR and branch differs from base: offer create_pr", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({
          clean: true,
          ahead: 0,
          files: [],
          actions: { ...status().actions, canPush: false, canCreatePullRequest: true },
        }),
        existingPr: null,
        runtimeBlockedReason: null,
      },
      null,
    );
    expect(result.dialogMode).toBe("synced_no_pr");
    expect(result.availableActions).toEqual(["create_pr"]);
  });

  it("synced with existing PR: no actions, view-PR mode", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({
          clean: true,
          ahead: 0,
          files: [],
          actions: { ...status().actions, canPush: false },
        }),
        existingPr: {
          title: "My PR",
          url: "https://github.test/pr/42",
          state: "open",
          number: 42,
          headBranch: "feature/demo",
          baseBranch: "main",
          draft: false,
        },
        runtimeBlockedReason: null,
      },
      null,
    );
    expect(result.dialogMode).toBe("synced_has_pr");
    expect(result.availableActions).toEqual([]);
  });

  it("blocked by conflicts: no actions", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({ conflicted: true }),
        existingPr: null,
        runtimeBlockedReason: null,
      },
      null,
    );
    expect(result.dialogMode).toBe("blocked");
    expect(result.blockingReason).toBe("Resolve conflicts before committing.");
    expect(result.availableActions).toEqual([]);
  });

  it("blocked by detached HEAD: no actions", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({ detached: true, currentBranch: undefined }),
        existingPr: null,
        runtimeBlockedReason: null,
      },
      null,
    );
    expect(result.dialogMode).toBe("blocked");
    expect(result.blockingReason).toBe("Switch to a branch before committing.");
  });

  it("blocked by runtime: no actions", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status(),
        existingPr: null,
        runtimeBlockedReason: "Workspace is starting.",
      },
      null,
    );
    expect(result.dialogMode).toBe("blocked");
    expect(result.blockingReason).toBe("Workspace is starting.");
    expect(result.availableActions).toEqual([]);
  });

  it("synced on same branch as base: no create_pr", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({
          currentBranch: "main",
          clean: true,
          ahead: 0,
          files: [],
          actions: { ...status().actions, canPush: false, canCreatePullRequest: true },
        }),
        existingPr: null,
        runtimeBlockedReason: null,
      },
      null,
    );
    expect(result.dialogMode).toBe("synced_no_pr");
    expect(result.availableActions).toEqual([]);
  });

  it("computes diff stats from all file groups", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({
          files: [
            file("a.ts", "included"),
            file("b.ts", "excluded"),
            file("c.ts", "partial"),
          ],
        }),
        existingPr: null,
        runtimeBlockedReason: null,
      },
      null,
    );
    expect(result.totalAdditions).toBe(15);
    expect(result.totalDeletions).toBe(6);
  });

  it("uses suggestedBaseBranch over repoDefaultBranch", () => {
    const result = deriveCommitDialogState(
      {
        gitStatus: status({ suggestedBaseBranch: "develop" }),
        existingPr: null,
        runtimeBlockedReason: null,
      },
      "main",
    );
    expect(result.defaultBaseBranch).toBe("develop");
  });
});

describe("validateCommitAction", () => {
  it("requires commit message when committing dirty tree", () => {
    expect(validateCommitAction({
      action: "commit",
      commitMessage: "",
      includeUnstaged: true,
      hasStagedChanges: false,
      hasUnstagedChanges: true,
      hasDirtyTree: true,
    })).toBe("Enter a commit message.");
  });

  it("requires staged or includeUnstaged when only unstaged present", () => {
    expect(validateCommitAction({
      action: "commit",
      commitMessage: "fix",
      includeUnstaged: false,
      hasStagedChanges: false,
      hasUnstagedChanges: true,
      hasDirtyTree: true,
    })).toBe("Stage changes or enable Include unstaged changes.");
  });

  it("passes with valid commit inputs", () => {
    expect(validateCommitAction({
      action: "commit",
      commitMessage: "fix bug",
      includeUnstaged: true,
      hasStagedChanges: false,
      hasUnstagedChanges: true,
      hasDirtyTree: true,
    })).toBeNull();
  });

  it("push action does not require commit message", () => {
    expect(validateCommitAction({
      action: "push",
      commitMessage: "",
      includeUnstaged: false,
      hasStagedChanges: false,
      hasUnstagedChanges: false,
      hasDirtyTree: false,
    })).toBeNull();
  });
});

describe("validatePrCreation", () => {
  it("requires title", () => {
    expect(validatePrCreation({ title: "", baseBranch: "main", branchName: "feat/x" }))
      .toBe("Enter a pull request title.");
  });

  it("requires base branch", () => {
    expect(validatePrCreation({ title: "Fix", baseBranch: "", branchName: "feat/x" }))
      .toBe("Choose a base branch.");
  });

  it("blocks same head and base branch", () => {
    expect(validatePrCreation({ title: "Fix", baseBranch: "main", branchName: "main" }))
      .toBe("Switch to a branch other than main before creating a PR.");
  });

  it("passes valid inputs", () => {
    expect(validatePrCreation({ title: "Fix", baseBranch: "main", branchName: "feat/x" }))
      .toBeNull();
  });
});
