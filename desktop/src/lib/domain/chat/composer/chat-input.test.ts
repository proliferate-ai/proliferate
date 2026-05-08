import { describe, expect, it } from "vitest";
import {
  resolveChatDraftWorkspaceId,
  resolveChatInputAvailability,
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
      hasBusyReview: false,
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
      hasBusyReview: false,
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
      hasBusyReview: false,
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
      hasBusyReview: false,
    })).toEqual({
      isDisabled: true,
      disabledReason: "Moving workspace.",
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind: "cloud",
    });
  });

  it("lets active review automation override normal availability", () => {
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
      hasBusyReview: true,
    })).toEqual({
      isDisabled: true,
      disabledReason: "Review automation is running.",
      areRuntimeControlsDisabled: true,
      selectedWorkspaceKind: "local",
    });
  });
});
