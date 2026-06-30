import { describe, expect, it } from "vitest";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import type { RepoRoot, Workspace } from "@anyharness/sdk";

function makeWorkspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "workspace-1",
    kind: "local",
    repoRootId: "repo-root-1",
    path: "/tmp/repo",
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRepoRoot(overrides: Partial<RepoRoot> = {}): RepoRoot {
  return {
    id: "repo-root-1",
    kind: "external",
    path: "/tmp/repo",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildSettingsRepositoryEntries", () => {
  it("prefers the local workspace as the repository workspace anchor", () => {
    const entries = buildSettingsRepositoryEntries([
      makeWorkspace({
        id: "repo-1",
        kind: "local",
      }),
      makeWorkspace({
        id: "worktree-1",
        kind: "worktree",
        path: "/tmp/proliferate-feature",
      }),
    ], [makeRepoRoot()]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      repoRootId: "repo-root-1",
      localWorkspaceId: "repo-1",
      workspaceCount: 2,
      sourceRoot: "/tmp/repo",
      cloudConfigured: false,
      availability: "local",
    });
  });

  it("keeps local-only groups as repositories", () => {
    const entries = buildSettingsRepositoryEntries([
      makeWorkspace({
        id: "repo-1",
        kind: "local",
      }),
    ], [makeRepoRoot()]);

    expect(entries).toHaveLength(1);
    expect(entries[0].workspaceCount).toBe(1);
    expect(entries[0].availability).toBe("local");
    expect(entries[0].cloudConfigured).toBe(false);
  });

  it("uses the source root as a secondary label when display names collide", () => {
    const entries = buildSettingsRepositoryEntries([], [
      makeRepoRoot({
        id: "repo-root-1",
        path: "/tmp/a/proliferate",
        displayName: "proliferate",
      }),
      makeRepoRoot({
        id: "repo-root-2",
        path: "/tmp/b/proliferate",
        displayName: "proliferate",
      }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.secondaryLabel)).toEqual([
      "/tmp/a/proliferate",
      "/tmp/b/proliferate",
    ]);
  });

  it("marks local GitHub repos that also have cloud config", () => {
    const entries = buildSettingsRepositoryEntries([], [
      makeRepoRoot({
        remoteOwner: "proliferate-ai",
        remoteRepoName: "proliferate",
        remoteProvider: "github",
      }),
    ], [{
      gitOwner: "proliferate-ai",
      gitRepoName: "proliferate",
      configured: true,
      configuredAt: "2026-06-24T00:00:00.000Z",
      defaultBranch: "main",
      filesVersion: 1,
    }]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      gitOwner: "proliferate-ai",
      gitRepoName: "proliferate",
      cloudConfigured: true,
      availability: "local_cloud",
    });
  });

  it("includes configured cloud repos without a local checkout", () => {
    const entries = buildSettingsRepositoryEntries([], [], [{
      gitOwner: "proliferate-ai",
      gitRepoName: "cloud-only",
      configured: true,
      configuredAt: "2026-06-24T00:00:00.000Z",
      defaultBranch: "main",
      filesVersion: 3,
    }]);

    expect(entries).toEqual([expect.objectContaining({
      sourceRoot: "cloud:proliferate-ai/cloud-only",
      name: "cloud-only",
      secondaryLabel: null,
      workspaceCount: 0,
      repoRootId: "",
      localWorkspaceId: null,
      gitProvider: "github",
      gitOwner: "proliferate-ai",
      gitRepoName: "cloud-only",
      defaultBranch: "main",
      cloudConfigured: true,
      availability: "cloud",
    })]);
  });
});
