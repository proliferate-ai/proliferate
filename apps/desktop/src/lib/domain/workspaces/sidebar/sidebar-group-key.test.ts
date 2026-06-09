import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import {
  buildSidebarGroupStates,
} from "@/lib/domain/workspaces/sidebar/sidebar-groups";
import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";
import {
  sidebarRepoGroupKeyForCloudTarget,
  sidebarRepoGroupKeyForWorkspace,
} from "./sidebar-group-key";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? "workspace-1",
    kind: overrides.kind ?? "worktree",
    repoRootId: overrides.repoRootId ?? "repo-root-1",
    path: overrides.path ?? "/tmp/proliferate/workspace-1",
    surface: overrides.surface ?? "standard",
    originalBranch: overrides.originalBranch ?? "main",
    currentBranch: overrides.currentBranch ?? "feature/workspace-1",
    displayName: overrides.displayName,
    executionSummary: overrides.executionSummary,
    lifecycleState: overrides.lifecycleState ?? "active",
    cleanupState: overrides.cleanupState ?? "none",
    createdAt: overrides.createdAt ?? "2026-04-13T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-13T10:00:00.000Z",
  };
}

function makeRepoRoot(overrides: Partial<RepoRoot> = {}): RepoRoot {
  return {
    id: overrides.id ?? "repo-root-1",
    kind: overrides.kind ?? "external",
    path: overrides.path ?? "/Users/pablo/proliferate",
    displayName: overrides.displayName ?? "proliferate",
    defaultBranch: overrides.defaultBranch ?? "main",
    remoteProvider: "remoteProvider" in overrides ? overrides.remoteProvider : "github",
    remoteOwner: "remoteOwner" in overrides ? overrides.remoteOwner : "proliferate-ai",
    remoteRepoName: "remoteRepoName" in overrides ? overrides.remoteRepoName : "proliferate",
    remoteUrl: overrides.remoteUrl ?? null,
    createdAt: overrides.createdAt ?? "2026-04-13T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-13T09:00:00.000Z",
  };
}

function sidebarSourceRootForWorkspace(
  workspace: Workspace,
  repoRoots: RepoRoot[],
): string {
  const logicalWorkspaces = buildLogicalWorkspaces({
    localWorkspaces: [workspace],
    repoRoots,
    cloudWorkspaces: [],
  });
  const groups = buildSidebarGroupStates({
    repoRoots,
    logicalWorkspaces,
    showArchived: false,
    workspaceTypes: DEFAULT_SIDEBAR_WORKSPACE_TYPES,
    archivedSet: new Set(),
    hiddenRepoRootIds: new Set(),
    selectedLogicalWorkspaceId: null,
    selectedWorkspaceId: null,
    workspaceActivities: {},
    gitStatus: undefined,
    activeSessionTitle: null,
    lastViewedAt: {},
    workspaceLastInteracted: {},
  });
  return groups[0]!.sourceRoot;
}

describe("sidebarRepoGroupKeyForWorkspace", () => {
  it("returns the repo-root path for a GitHub-backed workspace with a matching repoRootId", () => {
    const workspace = makeWorkspace({
      repoRootId: "repo-root-1",
    });
    const repoRoots = [makeRepoRoot()];

    expect(sidebarRepoGroupKeyForWorkspace(workspace, repoRoots)).toBe(
      sidebarSourceRootForWorkspace(workspace, repoRoots),
    );
  });

  it("falls back to the workspace path when a GitHub repo root is missing", () => {
    const workspace = makeWorkspace({
      repoRootId: "missing-root",
      path: "/tmp/proliferate",
    });

    expect(sidebarRepoGroupKeyForWorkspace(workspace, [])).toBe("/tmp/proliferate");
  });

  it("returns the workspace path for a local workspace with a missing repo root", () => {
    const workspace = makeWorkspace({
      repoRootId: "missing-root",
      path: "/tmp/local-only/session",
    });

    expect(sidebarRepoGroupKeyForWorkspace(workspace, [])).toBe("/tmp/local-only/session");
  });

  it("returns the parent repo-root path for a worktree workspace", () => {
    const workspace = makeWorkspace({
      id: "worktree-2",
      kind: "worktree",
      repoRootId: "repo-root-1",
      path: "/Users/pablo/.proliferate/worktrees/proliferate/feature-2",
    });

    expect(sidebarRepoGroupKeyForWorkspace(workspace, [makeRepoRoot()])).toBe(
      "/Users/pablo/proliferate",
    );
  });

  it("uses the workspace path when the repo root record is unavailable", () => {
    const workspace = makeWorkspace({
      repoRootId: "missing-root",
      path: "/tmp/standalone",
    });

    expect(sidebarRepoGroupKeyForWorkspace(workspace, [])).toBe("/tmp/standalone");
  });
});

describe("sidebarRepoGroupKeyForCloudTarget", () => {
  it("returns the local repo-root path for a matching GitHub target", () => {
    expect(
      sidebarRepoGroupKeyForCloudTarget(
        { gitOwner: "proliferate-ai", gitRepoName: "proliferate" },
        [makeRepoRoot()],
      ),
    ).toBe("/Users/pablo/proliferate");
  });

  it("falls back to a remote key when there is no matching local repo root", () => {
    expect(
      sidebarRepoGroupKeyForCloudTarget(
        { gitOwner: "proliferate-ai", gitRepoName: "proliferate" },
        [],
      ),
    ).toBe("github:proliferate-ai:proliferate");
  });
});
