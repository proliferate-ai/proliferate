import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import {
  collectLinkCandidates,
  linkedCloudWorkspaceByAnyharnessId,
} from "#product/lib/domain/workspaces/cloud/link-copies-candidates";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";

function root(overrides: Partial<RepoRoot> = {}): RepoRoot {
  return {
    id: "root-1",
    kind: "managed",
    path: "/code/rocket",
    remoteProvider: "github",
    remoteOwner: "acme",
    remoteRepoName: "rocket",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as RepoRoot;
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    repoRootId: "root-1",
    path: "/code/rocket-wt",
    currentBranch: "feat/x",
    originalBranch: "feat/x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    displayName: null,
    kind: "standard",
    lifecycleState: "active",
    surface: "desktop",
    cleanupState: "none",
    ...overrides,
  } as unknown as Workspace;
}

const CLOUD_REPO = { provider: "github", owner: "acme", name: "rocket" };

describe("collectLinkCandidates", () => {
  it("returns the same-repo/same-branch local workspace", () => {
    const candidates = collectLinkCandidates({
      localWorkspaces: [workspace()],
      repoRoots: [root()],
      cloudRepo: CLOUD_REPO,
      cloudBranch: "feat/x",
    });
    expect(candidates.map((c) => c.anyharnessWorkspaceId)).toEqual(["ws-1"]);
  });

  it("excludes a different repository or branch", () => {
    const otherRepo = collectLinkCandidates({
      localWorkspaces: [workspace()],
      repoRoots: [root({ remoteRepoName: "other" })],
      cloudRepo: CLOUD_REPO,
      cloudBranch: "feat/x",
    });
    expect(otherRepo).toHaveLength(0);

    const otherBranch = collectLinkCandidates({
      localWorkspaces: [workspace({ originalBranch: "feat/y", currentBranch: "feat/y" })],
      repoRoots: [root()],
      cloudRepo: CLOUD_REPO,
      cloudBranch: "feat/x",
    });
    expect(otherBranch).toHaveLength(0);
  });

  it("excludes a workspace already linked to this Cloud workspace", () => {
    const candidates = collectLinkCandidates({
      localWorkspaces: [workspace({ id: "ws-1" }), workspace({ id: "ws-2", path: "/code/rocket-wt-2" })],
      repoRoots: [root()],
      cloudRepo: CLOUD_REPO,
      cloudBranch: "feat/x",
      alreadyLinkedAnyharnessIds: new Set(["ws-1"]),
    });
    expect(candidates.map((c) => c.anyharnessWorkspaceId)).toEqual(["ws-2"]);
  });

  it("ambiguous candidates require selection: it returns ALL matches (never auto-picks one)", () => {
    const candidates = collectLinkCandidates({
      localWorkspaces: [
        workspace({ id: "ws-old", createdAt: "2026-01-01T00:00:00Z", path: "/a" }),
        workspace({ id: "ws-new", createdAt: "2026-02-01T00:00:00Z", path: "/b" }),
      ],
      repoRoots: [root()],
      cloudRepo: CLOUD_REPO,
      cloudBranch: "feat/x",
    });
    // Both plausible candidates surface — the caller must not silently pick the
    // oldest/first (PR5-LINK-02). Deterministic order (createdAt) for stable UI.
    expect(candidates.map((c) => c.anyharnessWorkspaceId)).toEqual(["ws-old", "ws-new"]);
    expect(candidates.length).toBeGreaterThan(1);
  });

  it("returns nothing when the Cloud repo or branch is unknown", () => {
    expect(
      collectLinkCandidates({
        localWorkspaces: [workspace()],
        repoRoots: [root()],
        cloudRepo: null,
        cloudBranch: "feat/x",
      }),
    ).toHaveLength(0);
  });
});

describe("linkedCloudWorkspaceByAnyharnessId", () => {
  it("indexes every active association across Cloud workspaces, including missing rows", () => {
    const cloudWorkspaces = [
      {
        id: "cloud-a",
        materializations: [{
          targetKind: "local_desktop",
          anyharnessWorkspaceId: "ws-linked-elsewhere",
          state: "hydrated",
        }],
      },
      {
        id: "cloud-b",
        materializations: [{
          targetKind: "local_desktop",
          anyharnessWorkspaceId: "ws-missing",
          state: "missing",
        }],
      },
    ] as unknown as CloudWorkspaceSummary[];

    expect(linkedCloudWorkspaceByAnyharnessId(cloudWorkspaces)).toEqual(
      new Map([
        ["ws-linked-elsewhere", "cloud-a"],
        ["ws-missing", "cloud-b"],
      ]),
    );
  });
});
