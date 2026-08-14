import { describe, expect, it } from "vitest";
import {
  launchIntentOwnsShell,
  resolveChatSurfaceState,
  resolveLaunchIntentSurfaceOverride,
  shouldMountWorkspaceShell,
  shouldKeepBootstrappedWorkspaceLoading,
  type ResolveChatSurfaceStateInput,
} from "#product/lib/domain/chat/surface/chat-surface";

function surfaceInput(
  overrides: Partial<ResolveChatSurfaceStateInput> = {},
): ResolveChatSurfaceStateInput {
  return {
    selectedWorkspaceId: "workspace-1",
    hasPendingWorkspaceEntry: false,
    activeLaunchIntentId: null,
    launchIntentScope: null,
    launchIntentInFlight: false,
    launchIntentSessionId: null,
    shellLogicalWorkspaceId: "workspace-1",
    shellWorkspaceId: "workspace-1",
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
      launchIntentScope: null,
      launchIntentSessionId: "session-1",
      activeSessionId: null,
      hasVisibleSessionContent: false,
      shellLogicalWorkspaceId: null,
      shellWorkspaceId: null,
    })).toEqual({ kind: "launch-intent", intentId: "launch-1" });
  });

  it("lets launch-owned transcript content take over from launch intent", () => {
    expect(resolveLaunchIntentSurfaceOverride({
      activeLaunchIntentId: "launch-1",
      launchIntentScope: null,
      launchIntentSessionId: "session-1",
      activeSessionId: "session-1",
      hasVisibleSessionContent: true,
      shellLogicalWorkspaceId: null,
      shellWorkspaceId: null,
    })).toEqual({ kind: "session-transcript", sessionId: "session-1" });
  });

  it("lets projected active transcript content take over before materialization", () => {
    expect(resolveLaunchIntentSurfaceOverride({
      activeLaunchIntentId: "launch-1",
      launchIntentScope: null,
      launchIntentSessionId: null,
      activeSessionId: "previous-session",
      hasVisibleSessionContent: true,
      shellLogicalWorkspaceId: null,
      shellWorkspaceId: null,
    })).toEqual({ kind: "session-transcript", sessionId: "previous-session" });
  });

  it("lets an intent scoped to the shown pending shell still own it", () => {
    expect(resolveLaunchIntentSurfaceOverride({
      activeLaunchIntentId: "launch-1",
      launchIntentScope: { pendingUiKey: "pending-workspace:attempt-1", workspaceId: null },
      launchIntentSessionId: null,
      activeSessionId: null,
      hasVisibleSessionContent: false,
      shellLogicalWorkspaceId: "pending-workspace:attempt-1",
      shellWorkspaceId: null,
    })).toEqual({ kind: "launch-intent", intentId: "launch-1" });
  });

  it("does not let an intent scoped to another attempt own this pending shell", () => {
    expect(resolveLaunchIntentSurfaceOverride({
      activeLaunchIntentId: "launch-1",
      launchIntentScope: { pendingUiKey: "pending-workspace:attempt-other", workspaceId: null },
      launchIntentSessionId: null,
      activeSessionId: null,
      hasVisibleSessionContent: false,
      shellLogicalWorkspaceId: "pending-workspace:attempt-1",
      shellWorkspaceId: null,
    })).toBeNull();
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

  it("keeps the launch-intent pane while a projected pending session has no content", () => {
    // The queued prompt has not landed in the projected session yet: the pane
    // already shows the prompt bubble + frontier at final transcript geometry,
    // so session-empty here would double-mount the creation receipt (canvas
    // topSlot, then pending-prompt frontier) and jump the transcript.
    expect(resolveChatSurfaceState(surfaceInput({
      selectedWorkspaceId: null,
      hasPendingWorkspaceEntry: true,
      activeLaunchIntentId: "launch-1",
      launchIntentScope: { pendingUiKey: "pending-workspace:attempt-1", workspaceId: null },
      launchIntentInFlight: true,
      launchIntentSessionId: "session-1",
      shellLogicalWorkspaceId: "pending-workspace:attempt-1",
      shellWorkspaceId: null,
      activeSessionId: "session-1",
      hasContent: false,
      isEmpty: true,
    }))).toEqual({ kind: "launch-intent", intentId: "launch-1" });
  });

  it("shows a failed pending projected session as session-empty, not the pane", () => {
    // The pending entry's creation receipt owns retry/back for failed
    // local/worktree creations; a failed intent must not steal that surface.
    expect(resolveChatSurfaceState(surfaceInput({
      selectedWorkspaceId: null,
      hasPendingWorkspaceEntry: true,
      activeLaunchIntentId: "launch-1",
      launchIntentScope: { pendingUiKey: "pending-workspace:attempt-1", workspaceId: null },
      launchIntentInFlight: false,
      launchIntentSessionId: "session-1",
      shellLogicalWorkspaceId: "pending-workspace:attempt-1",
      shellWorkspaceId: null,
      activeSessionId: "session-1",
      hasContent: false,
      isEmpty: true,
    }))).toEqual({ kind: "session-empty", sessionId: "session-1" });
  });

  it("shows a pending projected session without a launch intent as session-empty", () => {
    expect(resolveChatSurfaceState(surfaceInput({
      selectedWorkspaceId: null,
      hasPendingWorkspaceEntry: true,
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
      launchIntentScope: { pendingUiKey: "pending-workspace:attempt-1", workspaceId: null },
      launchIntentSessionId: "session-1",
      shellLogicalWorkspaceId: "pending-workspace:attempt-1",
      shellWorkspaceId: null,
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

  describe("launch intent scoping (PRO-230)", () => {
    it("does not let an intent scoped to workspace A override workspace B's shell", () => {
      expect(resolveChatSurfaceState(surfaceInput({
        selectedWorkspaceId: "workspace-b",
        activeLaunchIntentId: "launch-1",
        launchIntentScope: { pendingUiKey: null, workspaceId: "workspace-a" },
        shellLogicalWorkspaceId: "workspace-b",
        shellWorkspaceId: "workspace-b",
        activeSessionId: "session-b",
        hasContent: true,
        isEmpty: false,
      }))).toEqual({ kind: "session-transcript", sessionId: "session-b" });
    });

    it("does not let a failed intent scoped to workspace A override workspace B's shell", () => {
      expect(resolveChatSurfaceState(surfaceInput({
        selectedWorkspaceId: "workspace-b",
        activeLaunchIntentId: "launch-1",
        launchIntentScope: { pendingUiKey: null, workspaceId: "workspace-a" },
        launchIntentInFlight: false,
        shellLogicalWorkspaceId: "workspace-b",
        shellWorkspaceId: "workspace-b",
        activeSessionId: "session-b",
        hasContent: true,
        isEmpty: false,
      }))).toEqual({ kind: "session-transcript", sessionId: "session-b" });
    });

    it("lets an unscoped intent own an empty no-workspace shell", () => {
      expect(resolveChatSurfaceState(surfaceInput({
        selectedWorkspaceId: null,
        activeLaunchIntentId: "launch-1",
        launchIntentScope: null,
        shellLogicalWorkspaceId: null,
        shellWorkspaceId: null,
        activeSessionId: null,
        hasContent: false,
        isEmpty: true,
      }))).toEqual({ kind: "launch-intent", intentId: "launch-1" });
    });

    it("does not let an unscoped intent override a different selected workspace's shell", () => {
      expect(resolveChatSurfaceState(surfaceInput({
        selectedWorkspaceId: "workspace-b",
        activeLaunchIntentId: "launch-1",
        launchIntentScope: null,
        shellLogicalWorkspaceId: "workspace-b",
        shellWorkspaceId: "workspace-b",
        activeSessionId: "session-b",
        hasContent: true,
        isEmpty: false,
      }))).toEqual({ kind: "session-transcript", sessionId: "session-b" });
    });

    it("lets an intent scoped to the shown pending shell still own it", () => {
      expect(resolveChatSurfaceState(surfaceInput({
        selectedWorkspaceId: null,
        hasPendingWorkspaceEntry: true,
        activeLaunchIntentId: "launch-1",
        launchIntentScope: { pendingUiKey: "pending-workspace:attempt-1", workspaceId: null },
        launchIntentInFlight: true,
        launchIntentSessionId: null,
        shellLogicalWorkspaceId: "pending-workspace:attempt-1",
        shellWorkspaceId: null,
        activeSessionId: null,
        hasContent: false,
        isEmpty: true,
      }))).toEqual({ kind: "launch-intent", intentId: "launch-1" });
    });
  });

  describe("launchIntentOwnsShell", () => {
    it("owns an empty shell when unscoped", () => {
      expect(launchIntentOwnsShell({
        scope: null,
        shellLogicalWorkspaceId: null,
        shellWorkspaceId: null,
      })).toBe(true);
    });

    it("does not own a selected shell when unscoped", () => {
      expect(launchIntentOwnsShell({
        scope: null,
        shellLogicalWorkspaceId: "workspace-1",
        shellWorkspaceId: "workspace-1",
      })).toBe(false);
    });

    it("owns the shell matching its pending UI key", () => {
      expect(launchIntentOwnsShell({
        scope: { pendingUiKey: "pending-workspace:attempt-1", workspaceId: null },
        shellLogicalWorkspaceId: "pending-workspace:attempt-1",
        shellWorkspaceId: null,
      })).toBe(true);
    });

    it("does not own an unrelated shell when scoped", () => {
      expect(launchIntentOwnsShell({
        scope: { pendingUiKey: null, workspaceId: "workspace-a" },
        shellLogicalWorkspaceId: "workspace-b",
        shellWorkspaceId: "workspace-b",
      })).toBe(false);
    });

    it("owns the shell matching its materialized/target workspace id", () => {
      expect(launchIntentOwnsShell({
        scope: { pendingUiKey: null, workspaceId: "workspace-a" },
        shellLogicalWorkspaceId: "workspace-a",
        shellWorkspaceId: "workspace-a",
      })).toBe(true);
    });
  });
});
