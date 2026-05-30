import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "@anyharness/sdk";
import { buildMobilityGitPrepViewState } from "@/lib/domain/workspaces/mobility/mobility-git-prep";

function makeGitStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    workspaceId: "workspace-1",
    workspacePath: "/repo/workspace",
    repoRootPath: "/repo",
    currentBranch: "feature/move",
    headOid: "a".repeat(40),
    detached: false,
    upstreamBranch: "origin/feature/move",
    suggestedBaseBranch: "main",
    ahead: 0,
    behind: 0,
    operation: "none",
    conflicted: false,
    clean: true,
    summary: {
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      includedFiles: 0,
      conflictedFiles: 0,
    },
    actions: {
      canCommit: false,
      canPush: false,
      pushLabel: "Push",
      canCreatePullRequest: false,
      canCreateDraftPullRequest: false,
      canCreateBranchWorkspace: true,
    },
    files: [],
    ...overrides,
  } as GitStatusSnapshot;
}

describe("buildMobilityGitPrepViewState", () => {
  it("stages unstaged changes by default, commits, then pushes", () => {
    const view = buildMobilityGitPrepViewState({
      gitStatus: makeGitStatus({
        clean: false,
        actions: {
          canCommit: true,
          canPush: false,
          pushLabel: "Push",
          canCreatePullRequest: false,
          canCreateDraftPullRequest: false,
          canCreateBranchWorkspace: true,
        },
        files: [{
          path: "src/app.ts",
          status: "modified",
          additions: 5,
          deletions: 1,
          binary: false,
          includedState: "excluded",
        }],
      }),
      runtimeBlockedReason: null,
      direction: "local_to_cloud",
      commitDraft: {
        summary: "Save workspace changes before move",
        includeUnstaged: true,
      },
    });

    expect(view.primaryLabel).toBe("Commit, push, and move");
    expect(view.disabledReason).toBeNull();
    expect(view.workflowSteps).toEqual([
      { kind: "stage", paths: ["src/app.ts"] },
      { kind: "commit", summary: "Save workspace changes before move" },
      { kind: "push" },
    ]);
  });

  it("blocks auto-move when unstaged changes would intentionally remain", () => {
    const view = buildMobilityGitPrepViewState({
      gitStatus: makeGitStatus({
        clean: false,
        files: [{
          path: "src/app.ts",
          status: "modified",
          additions: 5,
          deletions: 1,
          binary: false,
          includedState: "excluded",
        }],
      }),
      runtimeBlockedReason: null,
      direction: "cloud_to_local",
      commitDraft: {
        summary: "Save workspace changes before move",
        includeUnstaged: false,
      },
    });

    expect(view.disabledReason).toBe(
      "Stage changes or include unstaged changes before committing.",
    );
    expect(view.workflowSteps).toEqual([]);
  });

  it("pushes clean unpublished commits without creating a commit", () => {
    const view = buildMobilityGitPrepViewState({
      gitStatus: makeGitStatus({
        ahead: 2,
        actions: {
          canCommit: false,
          canPush: true,
          pushLabel: "Push",
          canCreatePullRequest: false,
          canCreateDraftPullRequest: false,
          canCreateBranchWorkspace: true,
        },
      }),
      runtimeBlockedReason: null,
      direction: "local_to_cloud",
      commitDraft: {
        summary: "Save workspace changes before move",
        includeUnstaged: true,
      },
    });

    expect(view.primaryLabel).toBe("Push and move");
    expect(view.disabledReason).toBeNull();
    expect(view.workflowSteps).toEqual([{ kind: "push" }]);
  });

  it("keeps behind branches in strict manual recovery", () => {
    const view = buildMobilityGitPrepViewState({
      gitStatus: makeGitStatus({
        behind: 1,
        actions: {
          canCommit: false,
          canPush: false,
          pushLabel: "Push",
          canCreatePullRequest: false,
          canCreateDraftPullRequest: false,
          canCreateBranchWorkspace: true,
        },
      }),
      runtimeBlockedReason: null,
      direction: "local_to_cloud",
      commitDraft: {
        summary: "Save workspace changes before move",
        includeUnstaged: true,
      },
    });

    expect(view.disabledReason).toBe("Sync this branch before moving.");
    expect(view.workflowSteps).toEqual([]);
  });

  it("blocks commit prep while a Git operation is in progress", () => {
    const view = buildMobilityGitPrepViewState({
      gitStatus: makeGitStatus({
        clean: false,
        operation: "rebase",
        actions: {
          canCommit: true,
          canPush: false,
          pushLabel: "Push",
          canCreatePullRequest: false,
          canCreateDraftPullRequest: false,
          canCreateBranchWorkspace: true,
        },
        files: [{
          path: "src/app.ts",
          status: "modified",
          additions: 5,
          deletions: 1,
          binary: false,
          includedState: "excluded",
        }],
      }),
      runtimeBlockedReason: null,
      direction: "local_to_cloud",
      commitDraft: {
        summary: "Save workspace changes before move",
        includeUnstaged: true,
      },
    });

    expect(view.disabledReason).toBe("Finish the current Git operation before moving.");
    expect(view.workflowSteps).toEqual([]);
  });
});
