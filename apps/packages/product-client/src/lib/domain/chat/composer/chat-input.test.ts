import { describe, expect, it } from "vitest";
import {
  resolveChatDraftWorkspaceId,
  resolveChatInputAvailability,
} from "#product/lib/domain/chat/composer/chat-input";

describe("resolveChatDraftWorkspaceId", () => {
  it("prefers the logical workspace when one is selected", () => {
    expect(resolveChatDraftWorkspaceId("logical-1", "workspace-1")).toBe("logical-1");
  });

  it("falls back to the raw workspace id for cowork workspaces", () => {
    expect(resolveChatDraftWorkspaceId(null, "cowork-1")).toBe("cowork-1");
  });

  it("returns null when no workspace is selected", () => {
    expect(resolveChatDraftWorkspaceId(null, null)).toBeNull();
  });
});

describe("resolveChatInputAvailability", () => {
  it("blocks send but keeps editing and harness controls available during inline recovery", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "workspace-1",
      isCloudWorkspaceSelected: false,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "client-session:claude:1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      sessionRecoverySendReason: "Retry this chat before sending.",
      pendingWorkspaceEntry: null,
    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: "Retry this chat before sending.",
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "local",
    });
  });

  it("keeps the composer enabled while an active session transcript is still loading", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "workspace-1",
      isCloudWorkspaceSelected: false,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "session-1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: null,    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "local",
    });
  });

  it("keeps the composer enabled once the active session is hydrated", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "workspace-1",
      isCloudWorkspaceSelected: false,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "session-1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: null,    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "local",
    });
  });

  it("keeps pending workspace creation enabled until setup fails", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: null,
      isCloudWorkspaceSelected: false,
      connectionState: "starting",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: null,
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: false,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: {
        source: "cloud-created",
        stage: "awaiting-cloud-ready",
      },    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "cloud",
    });
  });

  it("keeps parent input enabled while background session work runs", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "workspace-1",
      isCloudWorkspaceSelected: false,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "session-1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: null,    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "local",
    });
  });

  it("keeps a ready workspace composer queueable when its projected session launch fails", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "cloud:workspace-1",
      isCloudWorkspaceSelected: true,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: "ready",
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: "ready",
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "client-session:claude:1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: false,
      configuredLaunchDisabledReason: "agent 'claude' is not ready (status: LoginRequired)",
      pendingWorkspaceEntry: null,
    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "cloud",
    });
  });

  it("still blocks a new session when no configured launch is ready", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "cloud:workspace-1",
      isCloudWorkspaceSelected: true,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: "ready",
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: "ready",
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: null,
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: false,
      configuredLaunchDisabledReason: "Choose a ready agent.",
      pendingWorkspaceEntry: null,
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Choose a ready agent.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
    });
  });

  it("still blocks an existing session while its cloud workspace is provisioning", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "cloud:workspace-1",
      isCloudWorkspaceSelected: true,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: "materializing",
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "client-session:claude:1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: null,
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Cloud workspace is still preparing.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: true,
    });
  });

  it("keeps pending approval, user-input, and MCP elicitation as chat blockers", () => {
    const base = {
      selectedWorkspaceId: "workspace-1",
      isCloudWorkspaceSelected: false,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "session-1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: null,    } as const;

    expect(resolveChatInputAvailability({
      ...base,
      pendingInteractionKind: "permission",
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Resolve the pending approval before sending another message.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
    });
    expect(resolveChatInputAvailability({
      ...base,
      pendingInteractionKind: "user_input",
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Answer the pending request before sending another message.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
    });
    expect(resolveChatInputAvailability({
      ...base,
      pendingInteractionKind: "mcp_elicitation",
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Complete the pending MCP form before sending another message.",
      sendBlockedReason: null,
      areRuntimeControlsDisabled: false,
    });
  });
  it("blocks send but keeps the editor editable when the worktree is missing", () => {
    const availability = resolveChatInputAvailability({
      selectedWorkspaceId: "workspace-1",
      isCloudWorkspaceSelected: false,
      workspaceDirectoryMissingSendReason: "Worktree no longer exists. Agents can't run in this workspace.",
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "session-1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: null,
    });

    expect(availability).toEqual({
      isDisabled: false,
      disabledReason: null,
      sendBlockedReason: "Worktree no longer exists. Agents can't run in this workspace.",
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind: "local",
    });
  });

  it("ignores the missing-directory reason for cloud workspaces", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "cloud:workspace-1",
      isCloudWorkspaceSelected: true,
      workspaceDirectoryMissingSendReason: "Worktree no longer exists. Agents can't run in this workspace.",
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: "ready",
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: "ready",
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "session-1",
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
      pendingWorkspaceEntry: null,
    }).sendBlockedReason).toBeNull();
  });
});
