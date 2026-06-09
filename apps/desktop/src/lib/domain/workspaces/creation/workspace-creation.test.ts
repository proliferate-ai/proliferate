import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";

import { resolveWorktreeCreationParams } from "./workspace-creation";

const repoRoot = {
  id: "repo-root-1",
  path: "/repos/proliferate",
  remoteRepoName: "proliferate",
  defaultBranch: "main",
} as RepoRoot;

const sourceWorkspace: Workspace = {
  id: "workspace-1",
  kind: "local",
  repoRootId: "repo-root-1",
  path: "/repos/proliferate",
  surface: "standard",
  currentBranch: "main",
  originalBranch: "main",
  lifecycleState: "active",
  cleanupState: "none",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

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
      checkoutMode: "new_branch",
      nameConflictPolicy: "suffix_path_and_branch",
    });
  });

  it("detaches generated worktrees when an explicit non-default base ref is selected", () => {
    const resolved = resolveWorktreeCreationParams({
      repoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        baseBranch: "feature/existing",
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
      baseRef: "feature/existing",
      checkoutMode: "detached_ref",
      nameConflictPolicy: "suffix_path",
    });
  });

  it("keeps explicit branch names in new-branch mode even with a non-default base ref", () => {
    const resolved = resolveWorktreeCreationParams({
      repoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        baseBranch: "feature/existing",
        branchName: "codex/custom",
        generatedName: true,
      },
      homeDir: "/Users/ada",
      branchPrefixType: "none",
      authUser: null,
      repoConfig: null,
    });

    expect(resolved.params).toMatchObject({
      branchName: "codex/custom",
      baseRef: "feature/existing",
      checkoutMode: "new_branch",
      nameConflictPolicy: "fail",
    });
  });

  it("keeps explicit base refs in new-branch mode when the repo default is unknown", () => {
    const resolved = resolveWorktreeCreationParams({
      repoRoot: {
        ...repoRoot,
        defaultBranch: null,
      } as RepoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        baseBranch: "main",
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
      baseRef: "main",
      checkoutMode: "new_branch",
      nameConflictPolicy: "suffix_path_and_branch",
    });
  });

  it("uses the provided default-branch hint to detach generated non-default worktrees", () => {
    const resolved = resolveWorktreeCreationParams({
      repoRoot: {
        ...repoRoot,
        defaultBranch: null,
      } as RepoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        baseBranch: "staging-mobile-config",
        defaultBranch: "main",
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
      baseRef: "staging-mobile-config",
      checkoutMode: "detached_ref",
      nameConflictPolicy: "suffix_path",
    });
  });

  it("keeps generated default-branch worktrees in new-branch mode with a default hint", () => {
    const resolved = resolveWorktreeCreationParams({
      repoRoot: {
        ...repoRoot,
        defaultBranch: null,
      } as RepoRoot,
      sourceWorkspace,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        baseBranch: "main",
        defaultBranch: "main",
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
      baseRef: "main",
      checkoutMode: "new_branch",
      nameConflictPolicy: "suffix_path_and_branch",
    });
  });

  it("uses the provided default-branch hint as the base ref fallback", () => {
    const resolved = resolveWorktreeCreationParams({
      repoRoot: {
        ...repoRoot,
        defaultBranch: null,
      } as RepoRoot,
      sourceWorkspace: null,
      rawInput: {
        repoRootId: "repo-root-1",
        workspaceName: "otter",
        defaultBranch: "main",
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
      baseRef: "main",
      checkoutMode: "new_branch",
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
