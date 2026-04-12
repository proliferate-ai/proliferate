import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  shouldKeepBootstrappedWorkspaceLoading,
  shouldShowStructuralRepoWorkspaceStatus,
} from "@/lib/domain/chat/chat-surface";

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

describe("chat surface", () => {
  it("shows repo workspace status when there is no active session", () => {
    expect(shouldShowStructuralRepoWorkspaceStatus(
      makeWorkspace({ id: "repo-1", kind: "repo" }),
      null,
    )).toBe(true);
  });

  it("keeps repo workspace transcripts visible once a session is active", () => {
    expect(shouldShowStructuralRepoWorkspaceStatus(
      makeWorkspace({ id: "repo-1", kind: "repo" }),
      "session-1",
    )).toBe(false);
  });

  it("does not treat worktrees as status-only", () => {
    expect(shouldShowStructuralRepoWorkspaceStatus(
      makeWorkspace({
        id: "worktree-1",
        kind: "worktree",
        path: "/tmp/repo-feature",
        sourceWorkspaceId: "repo-1",
      }),
      null,
    )).toBe(false);
  });

  it("does not treat cloud repo rows as structural", () => {
    expect(shouldShowStructuralRepoWorkspaceStatus(
      makeWorkspace({
        id: cloudWorkspaceSyntheticId("cloud-1"),
        kind: "repo",
        path: "github:owner:repo",
        sourceRepoRootPath: "github:owner:repo",
      }),
      null,
    )).toBe(false);
  });

  it("keeps a bootstrapped workspace on loading when restoring a remembered session", () => {
    expect(shouldKeepBootstrappedWorkspaceLoading({
      activeSessionId: null,
      hasBootstrappedWorkspace: true,
      rememberedSessionId: "session-1",
    })).toBe(true);
  });

  it("allows the empty state once there is no remembered session to restore", () => {
    expect(shouldKeepBootstrappedWorkspaceLoading({
      activeSessionId: null,
      hasBootstrappedWorkspace: true,
      rememberedSessionId: null,
    })).toBe(false);
  });

  it("does not hold loading once a session is already active", () => {
    expect(shouldKeepBootstrappedWorkspaceLoading({
      activeSessionId: "session-1",
      hasBootstrappedWorkspace: true,
      rememberedSessionId: "session-1",
    })).toBe(false);
  });
});
