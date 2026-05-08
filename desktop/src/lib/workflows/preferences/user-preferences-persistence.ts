import {
  getForwardCompatibleUserPreferenceExtras,
  hasDeprecatedUserPreferenceKeys,
  isValidWorktreeAutoDeleteLimit,
  migrateUserPreferences,
  NEW_USER_DEFAULTS,
  PERSISTED_RECORD_BACKFILL,
  pickLegacyUserPreferencesInput,
  type BranchPrefixType,
  type LegacyUserPreferencesInput,
  type UserPreferences,
} from "@/lib/domain/preferences/user-preferences";
import {
  buildPersistedUserPreferencesRecord,
  WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY,
  type PersistedUserPreferencesMetadata,
} from "@/lib/domain/preferences/persisted-metadata";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";

const USER_PREFERENCES_KEY = "user_preferences";
const LEGACY_THEME_KEY = "proliferate-theme";
const LEGACY_MODE_KEY = "proliferate-mode";

type LegacyThemeRecord = Pick<Partial<UserPreferences>, "themePreset" | "colorMode">;

export interface LoadedUserPreferences {
  preferences: UserPreferences;
  persistedMetadata: PersistedUserPreferencesMetadata;
  shouldPersist: boolean;
}

function readLegacyThemeRecord(): LegacyThemeRecord {
  if (typeof window === "undefined") {
    return {};
  }

  const themePresetRaw = window.localStorage.getItem(LEGACY_THEME_KEY);
  const colorModeRaw = window.localStorage.getItem(LEGACY_MODE_KEY);

  return {
    themePreset: themePresetRaw === "ship"
      || themePresetRaw === "mono"
      || themePresetRaw === "tbpn"
      || themePresetRaw === "original"
      ? themePresetRaw
      : undefined,
    colorMode: colorModeRaw === "dark"
      || colorModeRaw === "light"
      || colorModeRaw === "system"
      ? colorModeRaw
      : undefined,
  };
}

async function readLegacyUserPreferences(): Promise<LegacyUserPreferencesInput> {
  const legacyTheme = readLegacyThemeRecord();
  const legacyDefaultChatAgentKind = await readPersistedValue<string>("defaultChatAgentKind");
  const legacyDefaultChatModelId = await readPersistedValue<string>("defaultChatModelId");
  const legacyDefaultChatModelIdByAgentKind =
    await readPersistedValue<Record<string, string>>("defaultChatModelIdByAgentKind");
  const legacyDefaultOpenInTargetId = await readPersistedValue<string>("defaultOpenInTargetId");
  const legacyBranchPrefixType = await readPersistedValue<BranchPrefixType>("branchPrefixType");
  const hasLegacyPreference =
    legacyTheme.themePreset !== undefined
    || legacyTheme.colorMode !== undefined
    || legacyDefaultChatAgentKind !== undefined
    || legacyDefaultChatModelId !== undefined
    || legacyDefaultChatModelIdByAgentKind !== undefined
    || legacyDefaultOpenInTargetId !== undefined
    || legacyBranchPrefixType !== undefined;
  const defaults = hasLegacyPreference ? PERSISTED_RECORD_BACKFILL : NEW_USER_DEFAULTS;

  return {
    themePreset: legacyTheme.themePreset ?? defaults.themePreset,
    colorMode: legacyTheme.colorMode ?? defaults.colorMode,
    uiFontSizeId: defaults.uiFontSizeId,
    readableCodeFontSizeId: defaults.readableCodeFontSizeId,
    defaultChatAgentKind: legacyDefaultChatAgentKind ?? defaults.defaultChatAgentKind,
    ...(legacyDefaultChatModelId !== undefined
      ? { defaultChatModelId: legacyDefaultChatModelId }
      : {}),
    defaultChatModelIdByAgentKind:
      legacyDefaultChatModelIdByAgentKind ?? defaults.defaultChatModelIdByAgentKind,
    defaultSessionModeByAgentKind: defaults.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      defaults.defaultLiveSessionControlValuesByAgentKind,
    defaultOpenInTargetId: legacyDefaultOpenInTargetId ?? defaults.defaultOpenInTargetId,
    branchPrefixType: legacyBranchPrefixType ?? defaults.branchPrefixType,
    turnEndSoundEnabled: defaults.turnEndSoundEnabled,
    turnEndSoundId: defaults.turnEndSoundId,
    transparentChromeEnabled: defaults.transparentChromeEnabled,
    pluginsInCodingSessionsEnabled: defaults.pluginsInCodingSessionsEnabled,
    subagentsEnabled: defaults.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: defaults.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: defaults.cloudRuntimeInputSyncEnabled,
    worktreeAutoDeleteLimit: defaults.worktreeAutoDeleteLimit,
    pasteAttachmentsEnabled: defaults.pasteAttachmentsEnabled,
    reviewDefaultsByKind: defaults.reviewDefaultsByKind,
    reviewPersonalitiesByKind: defaults.reviewPersonalitiesByKind,
  };
}

async function readPersistedUserPreferences(): Promise<{
  preferences: LegacyUserPreferencesInput;
  shouldPersist: boolean;
  persistedMetadata: PersistedUserPreferencesMetadata;
  deferWorktreeAutoDeleteLimitPersist: boolean;
}> {
  const persisted = await readPersistedValue<Record<string, unknown>>(USER_PREFERENCES_KEY);
  if (persisted && typeof persisted === "object" && !Array.isArray(persisted)) {
    const needsWorktreeAdoption = !isValidWorktreeAutoDeleteLimit(
      persisted.worktreeAutoDeleteLimit,
    );
    const persistedMetadata = getForwardCompatibleUserPreferenceExtras(persisted);
    if (needsWorktreeAdoption) {
      persistedMetadata[WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY] = true;
    }
    return {
      preferences: pickLegacyUserPreferencesInput(persisted),
      shouldPersist: hasDeprecatedUserPreferenceKeys(persisted),
      persistedMetadata,
      deferWorktreeAutoDeleteLimitPersist: needsWorktreeAdoption,
    };
  }

  return {
    preferences: await readLegacyUserPreferences(),
    shouldPersist: false,
    persistedMetadata: {},
    deferWorktreeAutoDeleteLimitPersist: false,
  };
}

export async function loadUserPreferences(): Promise<LoadedUserPreferences> {
  const persisted = await readPersistedUserPreferences();
  const migrated = migrateUserPreferences(persisted.preferences);

  return {
    preferences: migrated.preferences,
    persistedMetadata: persisted.persistedMetadata,
    shouldPersist:
      persisted.deferWorktreeAutoDeleteLimitPersist
      || migrated.changed
      || persisted.shouldPersist,
  };
}

export async function persistUserPreferences(
  preferences: UserPreferences,
  persistedMetadata: PersistedUserPreferencesMetadata,
): Promise<void> {
  await persistValue(
    USER_PREFERENCES_KEY,
    buildPersistedUserPreferencesRecord(preferences, persistedMetadata),
  );
}
