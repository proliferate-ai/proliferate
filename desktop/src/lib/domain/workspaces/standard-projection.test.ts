import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/access/cloud/client";
import { buildStandardRepoProjection } from "@/lib/domain/workspaces/standard-projection";

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

const EMPTY_CLOUD_WORKSPACES: CloudWorkspaceSummary[] = [];

describe("buildStandardRepoProjection", () => {
  it("excludes the cowork repo root from generic repo surfaces", () => {
    const projection = buildStandardRepoProjection({
      repoRoots: [
        makeRepoRoot({ id: "repo-root-1" }),
        makeRepoRoot({ id: "cowork-root", path: "/tmp/cowork" }),
      ],
      localWorkspaces: [],
      cloudWorkspaces: EMPTY_CLOUD_WORKSPACES,
      coworkRootRepoRootId: "cowork-root",
    });

    expect(projection.repoRoots.map((repoRoot) => repoRoot.id)).toEqual(["repo-root-1"]);
  });

  it("excludes cowork and legacy structural repo workspaces", () => {
    const projection = buildStandardRepoProjection({
      repoRoots: [makeRepoRoot()],
      localWorkspaces: [
        makeWorkspace({ id: "local-1" }),
        makeWorkspace({ id: "cowork-1", surface: "cowork" }),
        makeWorkspace({ id: "repo-1", kind: "repo" as Workspace["kind"] }),
      ],
      cloudWorkspaces: EMPTY_CLOUD_WORKSPACES,
      coworkRootRepoRootId: null,
    });

    expect(projection.localWorkspaces.map((workspace) => workspace.id)).toEqual(["local-1"]);
  });
});
