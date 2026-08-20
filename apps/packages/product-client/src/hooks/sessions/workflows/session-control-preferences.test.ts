import type {
  NormalizedSessionControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  persistDefaultSessionControlPreference,
  shouldPersistDefaultSessionControlPreference,
} from "#product/hooks/sessions/workflows/session-control-preferences";
import { USER_PREFERENCE_DEFAULTS } from "#product/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

describe("session control preferences", () => {
  beforeEach(() => {
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
      _persistedMetadata: {},
    });
  });

  it("persists mode preferences for standard workspaces", () => {
    persistDefaultSessionControlPreference({
      agentKind: "claude",
      liveConfig: liveConfig({
        mode: control("mode", "mode", "bypassPermissions"),
      }),
      rawConfigId: "mode",
      workspaceSurface: "standard",
    });

    expect(
      useUserPreferencesStore.getState().defaultLiveSessionControlValuesByAgentKind,
    ).toEqual({ claude: { mode: "bypassPermissions" } });
  });

  it("persists an applied model as the last-used agent selection", () => {
    persistDefaultSessionControlPreference({
      agentKind: "codex",
      liveConfig: null,
      rawConfigId: "model",
      requestedValue: "gpt-5.6-sol",
      workspaceSurface: "standard",
    });

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.defaultChatAgentKind).toBe("codex");
    expect(preferences.defaultChatModelIdByAgentKind).toEqual({
      codex: "gpt-5.6-sol",
    });
  });

  it("persists controls under their exact target-observed ids", () => {
    const effortConfig = liveConfig({
      effort: control("effort", "reasoning_effort", "xhigh"),
      fastMode: control("fast_mode", "fast_mode", "off"),
    });
    persistDefaultSessionControlPreference({
      agentKind: "codex",
      liveConfig: effortConfig,
      rawConfigId: "reasoning_effort",
      requestedValue: "xhigh",
      workspaceSurface: "standard",
    });

    const speedConfig = liveConfig({
      effort: control("effort", "reasoning_effort", "xhigh"),
      fastMode: control("fast_mode", "fast_mode", "on"),
    });
    persistDefaultSessionControlPreference({
      agentKind: "codex",
      liveConfig: speedConfig,
      rawConfigId: "fast_mode",
      requestedValue: "on",
      workspaceSurface: "standard",
    });

    expect(
      useUserPreferencesStore.getState().defaultLiveSessionControlValuesByAgentKind,
    ).toEqual({
      codex: {
        reasoning_effort: "xhigh",
        fast_mode: "on",
      },
    });
  });

  it("does not persist control preferences for cowork workspaces", () => {
    persistDefaultSessionControlPreference({
      agentKind: "codex",
      liveConfig: liveConfig({
        effort: control("effort", "reasoning_effort", "xhigh"),
      }),
      rawConfigId: "reasoning_effort",
      workspaceSurface: "cowork",
    });

    expect(
      useUserPreferencesStore.getState().defaultLiveSessionControlValuesByAgentKind,
    ).toEqual({});
  });

  it("ignores controls that do not match the applied raw config id", () => {
    persistDefaultSessionControlPreference({
      agentKind: "codex",
      liveConfig: liveConfig({
        effort: control("effort", "reasoning_effort", "xhigh"),
      }),
      rawConfigId: "model",
      workspaceSurface: "standard",
    });

    expect(
      useUserPreferencesStore.getState().defaultLiveSessionControlValuesByAgentKind,
    ).toEqual({});
  });

  it("only persists for known standard workspace surfaces", () => {
    expect(shouldPersistDefaultSessionControlPreference("standard")).toBe(true);
    expect(shouldPersistDefaultSessionControlPreference("cowork")).toBe(false);
    expect(shouldPersistDefaultSessionControlPreference(null)).toBe(false);
    expect(shouldPersistDefaultSessionControlPreference(undefined)).toBe(false);
  });
});

function liveConfig(overrides: {
  mode?: NormalizedSessionControl | null;
  collaborationMode?: NormalizedSessionControl | null;
  reasoning?: NormalizedSessionControl | null;
  effort?: NormalizedSessionControl | null;
  fastMode?: NormalizedSessionControl | null;
}): SessionLiveConfigSnapshot {
  return {
    updatedAt: "2026-08-06T00:00:00.000Z",
    sourceSeq: 1,
    rawConfigOptions: [],
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    normalizedControls: {
      extras: [],
      model: null,
      mode: overrides.mode ?? null,
      collaborationMode: overrides.collaborationMode ?? null,
      reasoning: overrides.reasoning ?? null,
      effort: overrides.effort ?? null,
      fastMode: overrides.fastMode ?? null,
    },
  } as SessionLiveConfigSnapshot;
}

function control(
  key: string,
  rawConfigId: string,
  currentValue: string,
): NormalizedSessionControl {
  return {
    key,
    rawConfigId,
    label: key,
    settable: true,
    currentValue,
    values: [{ value: currentValue, label: currentValue }],
  };
}
