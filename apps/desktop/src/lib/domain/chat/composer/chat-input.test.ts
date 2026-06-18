import { describe, expect, it } from "vitest";
import {
  resolveChatDraftWorkspaceId,
  resolveChatInputAvailability,
  resolveCurrentModeLabel,
} from "./chat-input";

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

describe("resolveCurrentModeLabel", () => {
  const planControl = {
    currentValue: "plan",
    values: [
      { value: "default", label: "Default" },
      { value: "plan", label: "Plan" },
    ],
  };
  const permissionControl = {
    currentValue: "acceptEdits",
    values: [
      { value: "acceptEdits", label: "Accept edits" },
      { value: "readOnly", label: "Read only" },
    ],
  };

  it("prefers the collaboration mode control over the permission mode control", () => {
    expect(resolveCurrentModeLabel({
      liveConfig: {
        normalizedControls: {
          collaborationMode: planControl,
          mode: permissionControl,
        },
      },
    })).toBe("Plan");
  });

  it("falls back to the permission mode control when no collaboration mode exists", () => {
    expect(resolveCurrentModeLabel({
      liveConfig: {
        normalizedControls: {
          mode: permissionControl,
        },
      },
    })).toBe("Accept edits");
  });

  it("falls back to the slot mode id when no live config is present", () => {
    expect(resolveCurrentModeLabel({ modeId: "plan" })).toBe("plan");
  });

  it("returns null when no mode is resolvable", () => {
    expect(resolveCurrentModeLabel(null)).toBeNull();
  });
});

describe("resolveChatInputAvailability", () => {
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
      pendingWorkspaceEntry: null,
      mobility: null,
    })).toEqual({
      isDisabled: false,
      disabledReason: null,
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
      pendingWorkspaceEntry: null,
      mobility: null,
    })).toEqual({
      isDisabled: false,
      disabledReason: null,
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
      },
      mobility: null,
    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "cloud",
    });
  });

  it("lets mobility handoff override normal availability", () => {
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
      pendingWorkspaceEntry: null,
      mobility: {
        handoffActive: true,
        statusDescription: "Moving workspace.",
        selectedEffectiveOwner: "cloud",
      },
    })).toEqual({
      isDisabled: true,
      disabledReason: "Moving workspace.",
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind: "cloud",
    });
  });

  it("keeps parent input enabled while review automation runs in the background", () => {
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
      pendingWorkspaceEntry: null,
      mobility: null,
    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      areRuntimeControlsDisabled: false,
      selectedWorkspaceKind: "local",
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
      pendingWorkspaceEntry: null,
      mobility: null,
    } as const;

    expect(resolveChatInputAvailability({
      ...base,
      pendingInteractionKind: "permission",
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Resolve the pending approval before sending another message.",
      areRuntimeControlsDisabled: false,
    });
    expect(resolveChatInputAvailability({
      ...base,
      pendingInteractionKind: "user_input",
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Answer the pending request before sending another message.",
      areRuntimeControlsDisabled: false,
    });
    expect(resolveChatInputAvailability({
      ...base,
      pendingInteractionKind: "mcp_elicitation",
    })).toMatchObject({
      isDisabled: true,
      disabledReason: "Complete the pending MCP form before sending another message.",
      areRuntimeControlsDisabled: false,
    });
  });
});
