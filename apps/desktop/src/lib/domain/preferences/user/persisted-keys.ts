import type { UserPreferences } from "@/lib/domain/preferences/user/model";

const USER_PREFERENCE_KEYS = [
  "themePreset",
  "colorMode",
  "uiFontSizeId",
  "readableCodeFontSizeId",
  "windowZoomId",
  "defaultChatAgentKind",
  "defaultChatModelIdByAgentKind",
  "chatModelVisibilityOverridesByAgentKind",
  "defaultSessionModeByAgentKind",
  "defaultLiveSessionControlValuesByAgentKind",
  "defaultOpenInTargetId",
  "branchPrefixType",
  "defaultNewWorkspaceMode",
  "busySendBehavior",
  "turnEndSoundEnabled",
  "turnEndSoundId",
  "transparentChromeEnabled",
  "subagentsEnabled",
  "coworkWorkspaceDelegationEnabled",
  "worktreeAutoDeleteLimit",
  "pasteAttachmentsEnabled",
  "reviewDefaultsByKind",
  "reviewPersonalitiesByKind",
] as const satisfies readonly (keyof UserPreferences)[];

const USER_PREFERENCE_KEY_SET = new Set<string>(USER_PREFERENCE_KEYS);

const MIGRATED_USER_PREFERENCE_KEYS = [
  "defaultChatModelId",
] as const;

const MIGRATED_USER_PREFERENCE_KEY_SET = new Set<string>(MIGRATED_USER_PREFERENCE_KEYS);

const DEPRECATED_USER_PREFERENCE_KEYS = [
  "onboardingCompletedVersion",
  "onboardingPrimaryGoalId",
  "pluginsInCodingSessionsEnabled",
  "powersInCodingSessionsEnabled",
  "cloudRuntimeInputSyncEnabled",
] as const;

const DEPRECATED_USER_PREFERENCE_KEY_SET = new Set<string>(DEPRECATED_USER_PREFERENCE_KEYS);

export type LegacyUserPreferencesInput =
  Omit<Partial<UserPreferences>, "defaultChatModelIdByAgentKind"> & {
    defaultChatModelId?: unknown;
    defaultChatModelIdByAgentKind?: unknown;
  };

export function pickLegacyUserPreferencesInput(
  value: Record<string, unknown>,
): LegacyUserPreferencesInput {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => (
      USER_PREFERENCE_KEY_SET.has(key)
      || MIGRATED_USER_PREFERENCE_KEY_SET.has(key)
    )),
  ) as LegacyUserPreferencesInput;
}

export function hasDeprecatedUserPreferenceKeys(value: Record<string, unknown>): boolean {
  return DEPRECATED_USER_PREFERENCE_KEYS.some((key) => key in value);
}

export function getForwardCompatibleUserPreferenceExtras(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => (
      !USER_PREFERENCE_KEY_SET.has(key)
      && !MIGRATED_USER_PREFERENCE_KEY_SET.has(key)
      && !DEPRECATED_USER_PREFERENCE_KEY_SET.has(key)
    )),
  );
}
