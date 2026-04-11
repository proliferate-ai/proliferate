import { describe, expect, it } from "vitest";
import { buildSettingsRepositoryEntries } from "@/lib/domain/settings/repositories";
import type { Workspace } from "@anyharness/sdk";

function makeWorkspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "workspace-1",
    kind: "repo",
    path: "/tmp/repo",
    sourceRepoRootPath: "/tmp/repo",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildSettingsRepositoryEntries", () => {
  it("does not count the repo anchor row as a usable workspace", () => {
    const entries = buildSettingsRepositoryEntries([
      makeWorkspace({
        id: "repo-1",
        kind: "repo",
        gitRepoName: "proliferate",
      }),
      makeWorkspace({
        id: "worktree-1",
        kind: "worktree",
        path: "/tmp/proliferate-feature",
        sourceWorkspaceId: "repo-1",
        gitRepoName: "proliferate",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      repoWorkspaceId: "repo-1",
      workspaceCount: 1,
      sourceRoot: "/tmp/repo",
    });
  });

  it("keeps repo-only groups at zero usable workspaces", () => {
    const entries = buildSettingsRepositoryEntries([
      makeWorkspace({
        id: "repo-1",
        kind: "repo",
        gitRepoName: "proliferate",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].workspaceCount).toBe(0);
  });
});
