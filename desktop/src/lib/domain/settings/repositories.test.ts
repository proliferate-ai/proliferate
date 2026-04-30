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
    sourceRepoRootPath: "/tmp/repo",
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
        gitRepoName: "proliferate",
      }),
      makeWorkspace({
        id: "worktree-1",
        kind: "worktree",
        path: "/tmp/proliferate-feature",
        sourceWorkspaceId: "repo-1",
        gitRepoName: "proliferate",
      }),
    ], [makeRepoRoot()]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      repoRootId: "repo-root-1",
      localWorkspaceId: "repo-1",
      workspaceCount: 2,
      sourceRoot: "/tmp/repo",
    });
  });

  it("keeps local-only groups as repositories", () => {
    const entries = buildSettingsRepositoryEntries([
      makeWorkspace({
        id: "repo-1",
        kind: "local",
        gitRepoName: "proliferate",
      }),
    ], [makeRepoRoot()]);

    expect(entries).toHaveLength(1);
    expect(entries[0].workspaceCount).toBe(1);
  });
});
