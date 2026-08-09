import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import {
  getCloudRepoTargetForSelectedWorkspace,
  getRepoForSelectedWorkspace,
} from "#product/lib/domain/workspaces/cloud/selected-repo-target";

function workspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    availability: "available",
    kind: "worktree",
    repoRootId: "repo-root-1",
    path: "/tmp/repo/workspace-1",
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function repoRoot(overrides: Partial<RepoRoot> & { id: string }): RepoRoot {
  return {
    kind: "local",
    path: "/tmp/repo",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    remoteProvider: "github",
    remoteOwner: "acme",
    remoteRepoName: "widgets",
    ...overrides,
  };
}

// Cowork is deleted, so `surface: "cowork"` marks nothing but a legacy row: an
// ordinary workspace a user made back when the feature existed. These two
// helpers used to refuse it via `isStandardWorkspace`, which left those
// workspaces unable to resolve a repo target at all. Re-adding either guard
// fails these tests.
describe("selected repo target for legacy cowork workspaces", () => {
  it("resolves a repo context when the selected workspace is a legacy cowork workspace", () => {
    const selected = workspace({ id: "cowork-1", surface: "cowork", kind: "worktree" });
    const local = workspace({ id: "local-1", kind: "local" });

    const context = getRepoForSelectedWorkspace("cowork-1", [selected, local]);

    expect(context?.selectedWs.id).toBe("cowork-1");
    expect(context?.repoWs?.id).toBe("local-1");
  });

  it("groups legacy cowork siblings into the repo-target candidate set", () => {
    const selected = workspace({ id: "standard-1" });
    const coworkLocal = workspace({ id: "cowork-local", kind: "local", surface: "cowork" });

    const context = getRepoForSelectedWorkspace("standard-1", [selected, coworkLocal]);

    expect(context?.repoWs?.id).toBe("cowork-local");
  });

  it("resolves a cloud repo target from a legacy cowork workspace's repo root", () => {
    const selected = workspace({ id: "cowork-1", surface: "cowork", kind: "local" });

    const target = getCloudRepoTargetForSelectedWorkspace(
      "cowork-1",
      [selected],
      [],
      [repoRoot({ id: "repo-root-1" })],
    );

    expect(target).toEqual({ gitOwner: "acme", gitRepoName: "widgets" });
  });

  it("still returns null for an unknown workspace id", () => {
    expect(getRepoForSelectedWorkspace("missing", [workspace({ id: "cowork-1" })])).toBeNull();
    expect(getRepoForSelectedWorkspace(null, [])).toBeNull();
  });
});
