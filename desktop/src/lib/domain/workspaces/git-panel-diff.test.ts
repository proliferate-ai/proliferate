import type { GitChangedFile, GitDiffFile } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  buildGitPanelFiles,
  gitPanelDiffScope,
  gitPanelOpenAction,
  gitPanelRuntimeBlockWorkspaceId,
  resolveGitPanelBaseRef,
} from "./git-panel-diff";

function changedFile(overrides: Partial<GitChangedFile>): GitChangedFile {
  return {
    path: "file.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    includedState: "excluded",
    ...overrides,
  };
}

function branchFile(overrides: Partial<GitDiffFile>): GitDiffFile {
  return {
    path: "branch.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    ...overrides,
  };
}

describe("git panel diff domain", () => {
  it("keeps dirty mode filtering compatible while hiding internal worktree paths", () => {
    const statusFiles = [
      changedFile({ path: "unstaged.ts", includedState: "excluded" }),
      changedFile({ path: "partial.ts", includedState: "partial" }),
      changedFile({ path: "staged.ts", includedState: "included" }),
      changedFile({ path: ".claude/worktrees/hidden.ts", includedState: "excluded" }),
    ];

    expect(buildGitPanelFiles({
      mode: "unstaged",
      statusFiles,
      branchFiles: [],
    }).map((file) => file.path)).toEqual(["unstaged.ts", "partial.ts"]);

    expect(buildGitPanelFiles({
      mode: "staged",
      statusFiles,
      branchFiles: [],
    }).map((file) => file.path)).toEqual(["partial.ts", "staged.ts"]);
  });

  it("preserves oldPath and disables editor open for deleted branch rows", () => {
    const files = buildGitPanelFiles({
      mode: "branch",
      statusFiles: [],
      branchFiles: [
        branchFile({ path: "new.ts", oldPath: "old.ts", status: "renamed" }),
        branchFile({ path: "deleted.ts", status: "deleted" }),
      ],
    });

    expect(files[0]).toMatchObject({
      path: "new.ts",
      oldPath: "old.ts",
      displayPath: "old.ts -> new.ts",
    });
    expect(gitPanelOpenAction("branch", files[0])).toBe("file");
    expect(gitPanelOpenAction("branch", files[1])).toBe("disabled");
  });

  it("resolves branch base-ref precedence and mode scopes", () => {
    expect(resolveGitPanelBaseRef({
      repoPreferenceDefaultBranch: " release ",
      repoRootDefaultBranch: "main",
      suggestedBaseBranch: "develop",
    })).toBe("release");
    expect(resolveGitPanelBaseRef({
      repoPreferenceDefaultBranch: null,
      repoRootDefaultBranch: "main",
      suggestedBaseBranch: "develop",
    })).toBe("main");
    expect(resolveGitPanelBaseRef({
      repoPreferenceDefaultBranch: null,
      repoRootDefaultBranch: null,
      suggestedBaseBranch: "develop",
    })).toBe("develop");

    expect(gitPanelDiffScope("unstaged")).toBe("unstaged");
    expect(gitPanelDiffScope("staged")).toBe("staged");
    expect(gitPanelDiffScope("branch")).toBe("branch");
  });

  it("checks runtime blocking against the materialized workspace selection", () => {
    const blockedCloudWorkspaceId = "cloud:workspace-1";
    const runtimeBlockReason = (workspaceId: string | null) => (
      workspaceId === blockedCloudWorkspaceId
        ? "Cloud workspace is reconnecting."
        : null
    );

    expect(runtimeBlockReason(gitPanelRuntimeBlockWorkspaceId(
      blockedCloudWorkspaceId,
      "remote:github:owner:repo:main",
    ))).toBe("Cloud workspace is reconnecting.");
    expect(gitPanelRuntimeBlockWorkspaceId(
      blockedCloudWorkspaceId,
      "remote:github:owner:repo:main",
    )).toBe(blockedCloudWorkspaceId);
    expect(gitPanelRuntimeBlockWorkspaceId(null, "remote:github:owner:repo:main")).toBeNull();
  });
});
