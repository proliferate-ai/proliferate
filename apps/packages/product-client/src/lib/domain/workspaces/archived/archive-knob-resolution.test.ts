import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { RepoConfig } from "#product/lib/domain/preferences/repo-preferences";
import {
  resolveArchiveKnobSourceRoot,
  resolveArchiveWorkspaceRequest,
  resolveUnarchiveWorkspaceRequest,
} from "#product/lib/domain/workspaces/archived/archive-knob-resolution";

function makeRepoConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    defaultBranch: null,
    setupScript: "",
    runCommand: "",
    archiveScript: "",
    rerunSetupOnUnarchive: true,
    ...overrides,
  };
}

const repoRoots = [
  { id: "root-1", path: "/tmp/repo-1" } as unknown as RepoRoot,
];

describe("resolveArchiveKnobSourceRoot", () => {
  it("resolves through the workspace's repoRootId to the repo root's path", () => {
    const workspace = { repoRootId: "root-1", path: "/tmp/repo-1/worktree" } as unknown as Workspace;
    expect(resolveArchiveKnobSourceRoot(workspace, repoRoots)).toBe("/tmp/repo-1");
  });

  it("falls back to the workspace's own path when no repo root matches", () => {
    const workspace = { repoRootId: "missing", path: "/tmp/standalone" } as unknown as Workspace;
    expect(resolveArchiveKnobSourceRoot(workspace, repoRoots)).toBe("/tmp/standalone");
  });

  it("returns null for a null workspace", () => {
    expect(resolveArchiveKnobSourceRoot(null, repoRoots)).toBeNull();
  });
});

describe("resolveArchiveWorkspaceRequest", () => {
  it("carries the resolved deleteBranch preference and the repo's archiveScript", () => {
    const workspace = { repoRootId: "root-1", path: "/tmp/repo-1/worktree" } as unknown as Workspace;
    const request = resolveArchiveWorkspaceRequest({
      workspace,
      repoRoots,
      repoConfigs: { "/tmp/repo-1": makeRepoConfig({ archiveScript: "echo hi" }) },
      deleteBranchOnArchive: true,
    });
    expect(request).toEqual({ deleteBranch: true, archiveScript: "echo hi" });
  });

  it("falls back to an empty archiveScript when no repo config exists", () => {
    const workspace = { repoRootId: "missing", path: "/tmp/unknown" } as unknown as Workspace;
    const request = resolveArchiveWorkspaceRequest({
      workspace,
      repoRoots,
      repoConfigs: {},
      deleteBranchOnArchive: false,
    });
    expect(request).toEqual({ deleteBranch: false, archiveScript: "" });
  });
});

describe("resolveUnarchiveWorkspaceRequest", () => {
  const workspace = { repoRootId: "root-1", path: "/tmp/repo-1/worktree" } as unknown as Workspace;

  it("carries the resolved rerunSetup and setupScript for the workspace's repo root", () => {
    const request = resolveUnarchiveWorkspaceRequest({
      workspace,
      repoRoots,
      repoConfigs: {
        "/tmp/repo-1": makeRepoConfig({ setupScript: "npm install", rerunSetupOnUnarchive: false }),
      },
    });
    expect(request).toEqual({ rerunSetup: false, setupScript: "npm install" });
  });

  it("falls back to defaults when no repo config exists", () => {
    const request = resolveUnarchiveWorkspaceRequest({
      workspace: { repoRootId: "missing", path: "/tmp/unknown" } as unknown as Workspace,
      repoRoots,
      repoConfigs: {},
    });
    expect(request).toEqual({ rerunSetup: true, setupScript: "" });
  });

  it("carries a branchStrategy answer", () => {
    const request = resolveUnarchiveWorkspaceRequest({
      workspace,
      repoRoots,
      repoConfigs: {},
      answer: { branchStrategy: "recreate_at_sha" },
    });
    expect(request).toMatchObject({ branchStrategy: "recreate_at_sha" });
  });

  it("carries an overwrite answer only when true", () => {
    const request = resolveUnarchiveWorkspaceRequest({
      workspace,
      repoRoots,
      repoConfigs: {},
      answer: { overwrite: true },
    });
    expect(request).toMatchObject({ overwrite: true });
  });
});
