import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  resolveChatSurfaceState,
  resolveLaunchIntentSurfaceOverride,
  shouldMountWorkspaceShell,
  shouldKeepBootstrappedWorkspaceLoading,
  shouldShowStructuralRepoWorkspaceStatus,
  type ResolveChatSurfaceStateInput,
} from "@/lib/domain/chat/surface/chat-surface";

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

function surfaceInput(
  overrides: Partial<ResolveChatSurfaceStateInput> = {},
): ResolveChatSurfaceStateInput {
  return {
    selectedWorkspaceId: "workspace-1",
    hasPendingWorkspaceEntry: false,
    activeLaunchIntentId: null,
    launchIntentSessionId: null,
    selectedLocalWorkspace: null,
    isArrivalWorkspace: false,
    shouldShowSelectedCloudWorkspaceStatus: false,
    shouldPreserveVisibleCloudContent: false,
    shellRenderScope: null,
    activeSessionId: "session-1",
    hasContent: true,
    hasTranscriptEntry: true,
    hasSlot: true,
    transcriptHydrated: true,
    isEmpty: false,
    isRunning: false,
    streamConnectionState: "open",
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

  it("mounts the workspace shell for a launch intent before workspace selection exists", () => {
    expect(shouldMountWorkspaceShell({
      selectedWorkspaceId: null,
      hasPendingWorkspaceEntry: false,
      activeLaunchIntentId: "launch-1",
    })).toBe(true);
  });

  it("shows launch intent before session content exists", () => {
    expect(resolveLaunchIntentSurfaceOverride({
      activeLaunchIntentId: "launch-1",
      launchIntentSessionId: "session-1",
      activeSessionId: null,
      hasVisibleSessionContent: false,
    })).toEqual({ kind: "launch-intent", intentId: "launch-1" });
  });

  it("lets launch-owned transcript content take over from launch intent", () => {
    expect(resolveLaunchIntentSurfaceOverride({
      activeLaunchIntentId: "launch-1",
      launchIntentSessionId: "session-1",
      activeSessionId: "session-1",
      hasVisibleSessionContent: true,
    })).toEqual({ kind: "session-transcript", sessionId: "session-1" });
  });

  it("lets projected active transcript content take over before materialization", () => {
    expect(resolveLaunchIntentSurfaceOverride({
      activeLaunchIntentId: "launch-1",
      launchIntentSessionId: null,
      activeSessionId: "previous-session",
      hasVisibleSessionContent: true,
    })).toEqual({ kind: "session-transcript", sessionId: "previous-session" });
  });

  it("resolves no workspace when nothing is selected or launching", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      selectedWorkspaceId: null,
      activeSessionId: null,
      hasContent: false,
    }))).toEqual({ kind: "no-workspace" });
  });

  it("scopes chat shell render surfaces away from the active transcript", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      shellRenderScope: { kind: "chat-shell" },
    }))).toEqual({ kind: "session-empty", sessionId: null });
  });

  it("shows a pending projected session before the launch-intent pane", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      selectedWorkspaceId: null,
      hasPendingWorkspaceEntry: true,
      activeLaunchIntentId: "launch-1",
      launchIntentSessionId: "session-1",
      activeSessionId: "session-1",
      hasContent: false,
      isEmpty: true,
    }))).toEqual({ kind: "session-empty", sessionId: "session-1" });
  });

  it("shows pending projected session content as a transcript", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      selectedWorkspaceId: null,
      hasPendingWorkspaceEntry: true,
      activeLaunchIntentId: "launch-1",
      launchIntentSessionId: "session-1",
      activeSessionId: "session-1",
      hasContent: true,
      isEmpty: false,
    }))).toEqual({ kind: "session-transcript", sessionId: "session-1" });
  });

  it("shows pending session switching for pending session render surfaces", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      shellRenderScope: { kind: "chat-session-pending", sessionId: "session-2" },
    }))).toEqual({ kind: "session-switching", sessionId: "session-2" });
  });

  it("keeps a selected chat tab on the switching skeleton until its transcript entry exists", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      shellRenderScope: { kind: "chat-session", sessionId: "session-1" },
      hasContent: false,
      hasTranscriptEntry: false,
      transcriptHydrated: true,
      isEmpty: true,
      streamConnectionState: "open",
    }))).toEqual({ kind: "session-switching", sessionId: "session-1" });
  });

  it("shows the empty session state once a selected chat tab has an empty transcript entry", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      shellRenderScope: { kind: "chat-session", sessionId: "session-1" },
      hasContent: false,
      hasTranscriptEntry: true,
      transcriptHydrated: true,
      isEmpty: true,
      streamConnectionState: "open",
    }))).toEqual({ kind: "session-empty", sessionId: "session-1" });
  });

  it("keeps existing content visible during an unhydrated loading window", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      hasSlot: true,
      transcriptHydrated: false,
      streamConnectionState: "connecting",
      hasContent: true,
    }))).toEqual({ kind: "session-transcript", sessionId: "session-1" });
  });

  it("shows session hydrating before content arrives", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      hasSlot: true,
      transcriptHydrated: false,
      streamConnectionState: "connecting",
      hasContent: false,
    }))).toEqual({ kind: "session-hydrating", sessionId: "session-1" });
  });
});
