import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";

import { resolveWorktreeCreationParams } from "./workspace-creation";

const repoRoot = {
  id: "repo-root-1",
  path: "/repos/proliferate",
  remoteRepoName: "proliferate",
  defaultBranch: "main",
} as RepoRoot;

const sourceWorkspace = {
  id: "workspace-1",
  currentBranch: "main",
  originalBranch: "main",
  gitRepoName: "proliferate",
} as Workspace;

describe("worktree creation params", () => {
  it("suffixes generated local worktree path and branch conflicts", () => {
    const resolved = resolveWorktreeCreationParams({
      repoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        generatedName: true,
      },
      homeDir: "/Users/ada",
      branchPrefixType: "github_username",
      authUser: {
        id: "user-1",
        email: "ada@example.com",
        display_name: "Ada",
        github_login: "ada",
      },
      repoConfig: null,
    });

    expect(resolved.params).toMatchObject({
      branchName: "ada/otter",
      targetPath: "/Users/ada/.proliferate/worktrees/proliferate/otter",
      nameConflictPolicy: "suffix_path_and_branch",
    });
  });

  it("fails fast for generated names when branch or target path is explicit", () => {
    const withExplicitBranch = resolveWorktreeCreationParams({
      repoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        branchName: "codex/custom",
        generatedName: true,
      },
      homeDir: "/Users/ada",
      branchPrefixType: "none",
      authUser: null,
      repoConfig: null,
    });
    const withExplicitPath = resolveWorktreeCreationParams({
      repoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        targetPath: "/tmp/custom",
        generatedName: true,
      },
      homeDir: "/Users/ada",
      branchPrefixType: "none",
      authUser: null,
      repoConfig: null,
    });

    expect(withExplicitBranch.params.nameConflictPolicy).toBe("fail");
    expect(withExplicitPath.params.nameConflictPolicy).toBe("fail");
  });
});
