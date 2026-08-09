import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { buildStandardRepoProjection } from "#product/lib/domain/workspaces/cloud/standard-projection";

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
    availability: "available",
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

const EMPTY_CLOUD_WORKSPACES: CloudWorkspaceSummary[] = [];

describe("buildStandardRepoProjection", () => {
  // The cowork status API is gone, so the retired cowork root is identified by
  // its `managed` kind — the runtime-owned checkout was the only producer of
  // managed roots. Without this filter the rail grows a "Cowork" group.
  it("hides the managed (retired cowork) repo root from the repositories rail", () => {
    const projection = buildStandardRepoProjection({
      repoRoots: [
        makeRepoRoot({ id: "repo-root-1" }),
        makeRepoRoot({ id: "cowork-root", kind: "managed", path: "/tmp/cowork" }),
      ],
      localWorkspaces: [],
      cloudWorkspaces: EMPTY_CLOUD_WORKSPACES,
    });

    expect(projection.repoRoots.map((repoRoot) => repoRoot.id)).toEqual(["repo-root-1"]);
  });

  // Legacy cowork workspaces carry generated UUID names; listing them floods
  // the rail. They stay resolvable and openable — only the rail hides them.
  it("hides retired cowork-surface workspaces from the repositories rail", () => {
    const projection = buildStandardRepoProjection({
      repoRoots: [makeRepoRoot()],
      localWorkspaces: [
        makeWorkspace({ id: "local-1" }),
        makeWorkspace({ id: "cowork-1", surface: "cowork" }),
      ],
      cloudWorkspaces: EMPTY_CLOUD_WORKSPACES,
    });

    expect(projection.localWorkspaces.map((workspace) => workspace.id)).toEqual(["local-1"]);
  });

  it("passes external roots, standard workspaces, and cloud workspaces through untouched", () => {
    const cloudWorkspaces = [
      { id: "cloud-1" } as unknown as CloudWorkspaceSummary,
    ];
    const projection = buildStandardRepoProjection({
      repoRoots: [makeRepoRoot()],
      localWorkspaces: [makeWorkspace({ id: "local-1" })],
      cloudWorkspaces,
    });

    expect(projection.repoRoots.map((repoRoot) => repoRoot.id)).toEqual(["repo-root-1"]);
    expect(projection.localWorkspaces.map((workspace) => workspace.id)).toEqual(["local-1"]);
    expect(projection.cloudWorkspaces).toBe(cloudWorkspaces);
  });
});
