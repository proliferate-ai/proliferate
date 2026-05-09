import { describe, expect, it } from "vitest";
import {
  getForwardCompatibleUserPreferenceExtras,
  hasDeprecatedUserPreferenceKeys,
  migrateUserPreferences,
  pickLegacyUserPreferencesInput,
  USER_PREFERENCE_DEFAULTS,
  WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
} from "@/lib/domain/preferences/user-preferences";

describe("user preferences", () => {
  it("migrates legacy model and powers preferences into the current shape", () => {
    const result = migrateUserPreferences({
      defaultChatAgentKind: " claude ",
      defaultChatModelId: " claude-sonnet-4-5-1m ",
      powersInCodingSessionsEnabled: true,
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultChatAgentKind).toBe("claude");
    expect(result.preferences.defaultChatModelIdByAgentKind).toEqual({
      claude: "sonnet[1m]",
    });
    expect(result.preferences.pluginsInCodingSessionsEnabled).toBe(true);
    expect(result.preferences).not.toHaveProperty("powersInCodingSessionsEnabled");
  });

  it("sanitizes per-agent model, session mode, and live control maps", () => {
    const result = migrateUserPreferences({
      defaultChatModelIdByAgentKind: {
        " claude ": " claude-opus-4-5 ",
        assistant: " gpt-5 ",
        " ": "ignored",
        empty: " ",
      },
      defaultSessionModeByAgentKind: {
        assistant: " plan ",
        empty: " ",
        " ": "code",
      },
      defaultLiveSessionControlValuesByAgentKind: {
        assistant: {
          effort: " high ",
          reasoning: " medium ",
          ignored: "value",
        },
        empty: {
          effort: " ",
        },
        " ": {
          effort: "low",
        },
      } as unknown as typeof USER_PREFERENCE_DEFAULTS.defaultLiveSessionControlValuesByAgentKind,
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultChatModelIdByAgentKind).toEqual({
      claude: "opus[1m]",
      assistant: "gpt-5",
    });
    expect(result.preferences.defaultSessionModeByAgentKind).toEqual({
      assistant: " plan ",
    });
    expect(result.preferences.defaultLiveSessionControlValuesByAgentKind).toEqual({
      assistant: {
        effort: "high",
        reasoning: "medium",
      },
    });
  });

  it("falls back invalid persisted values without changing new-user defaults", () => {
    const result = migrateUserPreferences({
      subagentsEnabled: "yes" as unknown as boolean,
      coworkWorkspaceDelegationEnabled: "yes" as unknown as boolean,
      cloudRuntimeInputSyncEnabled: "yes" as unknown as boolean,
      worktreeAutoDeleteLimit: 8,
      pasteAttachmentsEnabled: "yes" as unknown as boolean,
      uiFontSizeId: "giant" as typeof USER_PREFERENCE_DEFAULTS.uiFontSizeId,
      readableCodeFontSizeId: "tiny" as typeof USER_PREFERENCE_DEFAULTS.readableCodeFontSizeId,
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.subagentsEnabled).toBe(true);
    expect(result.preferences.coworkWorkspaceDelegationEnabled).toBe(true);
    expect(result.preferences.cloudRuntimeInputSyncEnabled).toBe(false);
    expect(result.preferences.worktreeAutoDeleteLimit).toBe(WORKTREE_AUTO_DELETE_LIMIT_DEFAULT);
    expect(result.preferences.pasteAttachmentsEnabled).toBe(true);
    expect(result.preferences.uiFontSizeId).toBe("default");
    expect(result.preferences.readableCodeFontSizeId).toBe("default");
    expect(USER_PREFERENCE_DEFAULTS.transparentChromeEnabled).toBe(false);
  });

  it("splits known legacy input from forward-compatible extras", () => {
    const persisted = {
      themePreset: "mono",
      defaultChatModelId: "gpt-5",
      powersInCodingSessionsEnabled: false,
      onboardingCompletedVersion: 2,
      futureBoolean: true,
      futureNested: { enabled: true },
    };

    expect(pickLegacyUserPreferencesInput(persisted)).toEqual({
      themePreset: "mono",
      defaultChatModelId: "gpt-5",
      powersInCodingSessionsEnabled: false,
    });
    expect(getForwardCompatibleUserPreferenceExtras(persisted)).toEqual({
      futureBoolean: true,
      futureNested: { enabled: true },
    });
    expect(hasDeprecatedUserPreferenceKeys(persisted)).toBe(true);
  });
});
