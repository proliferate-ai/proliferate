import { beforeEach, describe, expect, it } from "vitest";
import {
  persistDefaultSessionModePreference,
  shouldPersistDefaultSessionModePreference,
} from "@/hooks/sessions/session-mode-preferences";
import {
  USER_PREFERENCE_DEFAULTS,
  useUserPreferencesStore,
} from "@/stores/preferences/user-preferences-store";

describe("session mode preferences", () => {
  beforeEach(() => {
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
    });
  });

  it("persists mode preferences for standard workspaces", () => {
    persistDefaultSessionModePreference({
      agentKind: "claude",
      liveConfigRawConfigId: "mode",
      rawConfigId: "mode",
      modeId: "bypassPermissions",
      workspaceSurface: "standard",
    });

    expect(useUserPreferencesStore.getState().defaultSessionModeByAgentKind).toEqual({
      claude: "bypassPermissions",
    });
  });

  it("does not persist mode preferences for cowork workspaces", () => {
    persistDefaultSessionModePreference({
      agentKind: "claude",
      liveConfigRawConfigId: "mode",
      rawConfigId: "mode",
      modeId: "bypassPermissions",
      workspaceSurface: "cowork",
    });

    expect(useUserPreferencesStore.getState().defaultSessionModeByAgentKind).toEqual({});
  });

  it("only persists for known standard workspace surfaces", () => {
    expect(shouldPersistDefaultSessionModePreference("standard")).toBe(true);
    expect(shouldPersistDefaultSessionModePreference("cowork")).toBe(false);
    expect(shouldPersistDefaultSessionModePreference(null)).toBe(false);
    expect(shouldPersistDefaultSessionModePreference(undefined)).toBe(false);
  });
});
