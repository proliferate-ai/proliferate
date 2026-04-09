import { describe, expect, it } from "vitest";
import { resolveChatInputAvailability } from "./chat-input";

describe("resolveChatInputAvailability", () => {
  it("disables the composer while the active session transcript is still loading", () => {
    expect(resolveChatInputAvailability({
      selectedWorkspaceId: "workspace-1",
      isCloudWorkspaceSelected: false,
      connectionState: "healthy",
      selectedCloudWorkspaceStatus: null,
      selectedCloudWorkspaceActionBlockReason: null,
      selectedCloudRuntimePhase: null,
      selectedCloudRuntimeActionBlockReason: null,
      activeSessionId: "session-1",
      activeSessionHydrated: false,
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
    })).toEqual({
      isDisabled: true,
      disabledReason: "Session is still loading. Try again in a moment.",
      areRuntimeControlsDisabled: false,
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
      activeSessionHydrated: true,
      isConfiguredLaunchLoading: false,
      hasReadyConfiguredLaunch: true,
      configuredLaunchDisabledReason: null,
    })).toEqual({
      isDisabled: false,
      disabledReason: null,
      areRuntimeControlsDisabled: false,
    });
  });
});
