import { describe, expect, it } from "vitest";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  isStructuralRepoWorkspace,
  isUsableWorkspace,
} from "@/lib/domain/workspaces/usability";
import type { Workspace } from "@anyharness/sdk";

function makeWorkspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "workspace-1",
    kind: "repo",
    path: "/tmp/repo",
    sourceRepoRootPath: "/tmp/repo",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace usability", () => {
  it("treats local repo rows as structural-only", () => {
    const workspace = makeWorkspace({ id: "repo-1", kind: "repo" });

    expect(isStructuralRepoWorkspace(workspace)).toBe(true);
    expect(isUsableWorkspace(workspace)).toBe(false);
  });

  it("keeps worktrees usable", () => {
    const workspace = makeWorkspace({
      id: "worktree-1",
      kind: "worktree",
      path: "/tmp/repo-feature",
      sourceWorkspaceId: "repo-1",
    });

    expect(isStructuralRepoWorkspace(workspace)).toBe(false);
    expect(isUsableWorkspace(workspace)).toBe(true);
  });

  it("keeps local workspaces usable", () => {
    const workspace = makeWorkspace({
      id: "local-1",
      kind: "local",
      sourceWorkspaceId: "repo-1",
    });

    expect(isStructuralRepoWorkspace(workspace)).toBe(false);
    expect(isUsableWorkspace(workspace)).toBe(true);
  });

  it("keeps synthetic cloud workspaces usable", () => {
    const workspace = makeWorkspace({
      id: cloudWorkspaceSyntheticId("cloud-1"),
      kind: "repo",
      path: "github:owner:repo",
      sourceRepoRootPath: "github:owner:repo",
    });

    expect(isStructuralRepoWorkspace(workspace)).toBe(false);
    expect(isUsableWorkspace(workspace)).toBe(true);
  });
});
