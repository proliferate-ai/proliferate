import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  resolveChatSurfaceState,
  shouldShowStructuralRepoWorkspaceStatus,
} from "@/lib/domain/chat/chat-surface";

function makeWorkspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "workspace-1",
    kind: "repo",
    surfaceKind: "code",
    path: "/tmp/repo",
    sourceRepoRootPath: "/tmp/repo",
    defaultSessionId: null,
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

  it("uses pending-thread-creation while a cowork thread is being created", () => {
    expect(resolveChatSurfaceState({
      selectedWorkspaceId: null,
      selectedWorkspace: null,
      hasPendingWorkspaceEntry: false,
      hasPendingCoworkThread: true,
      shouldShowCloudStatus: false,
      isArrivalWorkspaceWithoutContent: false,
      activeSessionId: null,
      hasWorkspaceBootstrappedInSession: false,
      hasSlot: false,
      transcriptHydrated: false,
      isEmpty: false,
      isRunning: false,
      streamConnectionState: null,
      shouldPreserveTranscript: false,
    })).toEqual({ kind: "pending-thread-creation" });
  });

  it("keeps cowork workspaces on transcript when a session is active", () => {
    expect(resolveChatSurfaceState({
      selectedWorkspaceId: "cowork-1",
      selectedWorkspace: makeWorkspace({
        id: "cowork-1",
        kind: "worktree",
        surfaceKind: "cowork",
        path: "/tmp/cowork-1",
      }),
      hasPendingWorkspaceEntry: false,
      hasPendingCoworkThread: false,
      shouldShowCloudStatus: false,
      isArrivalWorkspaceWithoutContent: false,
      activeSessionId: "session-1",
      hasWorkspaceBootstrappedInSession: true,
      hasSlot: true,
      transcriptHydrated: true,
      isEmpty: false,
      isRunning: false,
      streamConnectionState: "open",
      shouldPreserveTranscript: false,
    })).toEqual({ kind: "session-transcript", sessionId: "session-1" });
  });

  it("keeps code workspaces on loading until the first session is ready", () => {
    expect(resolveChatSurfaceState({
      selectedWorkspaceId: "worktree-1",
      selectedWorkspace: makeWorkspace({
        id: "worktree-1",
        kind: "worktree",
        surfaceKind: "code",
        path: "/tmp/worktree-1",
      }),
      hasPendingWorkspaceEntry: false,
      hasPendingCoworkThread: false,
      shouldShowCloudStatus: false,
      isArrivalWorkspaceWithoutContent: false,
      activeSessionId: null,
      hasWorkspaceBootstrappedInSession: false,
      hasSlot: false,
      transcriptHydrated: false,
      isEmpty: false,
      isRunning: false,
      streamConnectionState: null,
      shouldPreserveTranscript: false,
    })).toEqual({ kind: "session-loading", sessionId: null });
  });
});
