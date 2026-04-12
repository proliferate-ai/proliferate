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
