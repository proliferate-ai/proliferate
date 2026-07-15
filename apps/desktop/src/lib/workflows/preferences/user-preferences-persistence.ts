import {
  migrateUserPreferences,
} from "@/lib/domain/preferences/user/migration";
import {
  getForwardCompatibleUserPreferenceExtras,
  hasDeprecatedUserPreferenceKeys,
  pickLegacyUserPreferencesInput,
  type LegacyUserPreferencesInput,
} from "@/lib/domain/preferences/user/persisted-keys";
import {
  NEW_USER_DEFAULTS,
  PERSISTED_RECORD_BACKFILL,
  type BranchPrefixType,
  type UserPreferences,
} from "@/lib/domain/preferences/user/model";
import { isValidWorktreeAutoDeleteLimit } from "@/lib/domain/preferences/user/worktree-auto-delete";
import {
  buildPersistedUserPreferencesRecord,
  hasAppliedModelVisibilityDefaultsReset,
  markModelVisibilityDefaultsReset,
  WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY,
  type PersistedUserPreferencesMetadata,
} from "@/lib/domain/preferences/persisted-metadata";
import {
  readPersistedJsonValue,
  readPersistedStringValue,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";
import {
  resetFrontierModelVisibilityOverrides,
} from "@/lib/domain/preferences/user/session-defaults";

const USER_PREFERENCES_KEY = "user_preferences";
const LEGACY_THEME_KEY = "proliferate-theme";
const LEGACY_MODE_KEY = "proliferate-mode";

type LegacyThemeRecord = Pick<Partial<UserPreferences>, "themePreset" | "colorMode">;

export interface LoadedUserPreferences {
  preferences: UserPreferences;
  persistedMetadata: PersistedUserPreferencesMetadata;
  shouldPersist: boolean;
}

async function readLegacyThemeRecord(
  context: ProductStorageContext,
): Promise<LegacyThemeRecord> {
  // The legacy theme keys historically lived in raw browser localStorage; the
  // Desktop ProductStorage adapter reads through to it on a store miss, so
  // routing them through the injected storage preserves the values while
  // closing this module's direct browser-global import.
  const themePresetRaw = await readPersistedStringValue(context, LEGACY_THEME_KEY);
  const colorModeRaw = await readPersistedStringValue(context, LEGACY_MODE_KEY);

  return {
    // Any legacy preset choice collapses to the single Mono theme; a valid
    // value still counts as "has legacy preferences" for backfill defaults.
    themePreset: themePresetRaw === "ship"
      || themePresetRaw === "mono"
      || themePresetRaw === "tbpn"
      || themePresetRaw === "original"
      ? "mono"
      : undefined,
    colorMode: colorModeRaw === "dark"
      || colorModeRaw === "light"
      || colorModeRaw === "system"
      ? colorModeRaw
      : undefined,
  };
}

async function readLegacyUserPreferences(
  context: ProductStorageContext,
): Promise<LegacyUserPreferencesInput> {
  const legacyTheme = await readLegacyThemeRecord(context);
  const legacyDefaultChatAgentKind =
    await readPersistedStringValue(context, "defaultChatAgentKind");
  const legacyDefaultChatModelId =
    await readPersistedStringValue(context, "defaultChatModelId");
  const legacyDefaultChatModelIdByAgentKind =
    await readPersistedJsonValue<Record<string, string>>(context, "defaultChatModelIdByAgentKind");
  const legacyDefaultOpenInTargetId =
    await readPersistedStringValue(context, "defaultOpenInTargetId");
  const legacyBranchPrefixType =
    await readPersistedStringValue(context, "branchPrefixType") as BranchPrefixType | undefined;
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
    windowZoomId: defaults.windowZoomId,
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
    subagentsEnabled: defaults.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: defaults.coworkWorkspaceDelegationEnabled,
    worktreeAutoDeleteLimit: defaults.worktreeAutoDeleteLimit,
    pasteAttachmentsEnabled: defaults.pasteAttachmentsEnabled,
    reviewDefaultsByKind: defaults.reviewDefaultsByKind,
    reviewPersonalitiesByKind: defaults.reviewPersonalitiesByKind,
  };
}

async function readPersistedUserPreferences(
  context: ProductStorageContext,
): Promise<{
  preferences: LegacyUserPreferencesInput;
  shouldPersist: boolean;
  persistedMetadata: PersistedUserPreferencesMetadata;
  deferWorktreeAutoDeleteLimitPersist: boolean;
  resetModelVisibilityDefaults: boolean;
}> {
  const persisted =
    await readPersistedJsonValue<Record<string, unknown>>(context, USER_PREFERENCES_KEY);
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
      resetModelVisibilityDefaults: !hasAppliedModelVisibilityDefaultsReset(
        persistedMetadata,
      ),
    };
  }

  return {
    preferences: await readLegacyUserPreferences(context),
    shouldPersist: false,
    persistedMetadata: markModelVisibilityDefaultsReset({}),
    deferWorktreeAutoDeleteLimitPersist: false,
    resetModelVisibilityDefaults: false,
  };
}

export async function loadUserPreferences(
  context: ProductStorageContext,
): Promise<LoadedUserPreferences> {
  const persisted = await readPersistedUserPreferences(context);
  let migrated = migrateUserPreferences(persisted.preferences);
  let persistedMetadata = persisted.persistedMetadata;
  let shouldPersist = (
    persisted.deferWorktreeAutoDeleteLimitPersist
    || migrated.changed
    || persisted.shouldPersist
  );

  if (persisted.resetModelVisibilityDefaults) {
    const reset = resetFrontierModelVisibilityOverrides(
      migrated.preferences.chatModelVisibilityOverridesByAgentKind,
    );
    migrated = {
      preferences: {
        ...migrated.preferences,
        chatModelVisibilityOverridesByAgentKind:
          reset.chatModelVisibilityOverridesByAgentKind,
      },
      changed: migrated.changed || reset.changed,
    };
    persistedMetadata = markModelVisibilityDefaultsReset(persistedMetadata);
    shouldPersist = true;
  }

  return {
    preferences: migrated.preferences,
    persistedMetadata,
    shouldPersist,
  };
}

export async function persistUserPreferences(
  context: ProductStorageContext,
  preferences: UserPreferences,
  persistedMetadata: PersistedUserPreferencesMetadata,
): Promise<void> {
  await writePersistedJson(
    context,
    USER_PREFERENCES_KEY,
    buildPersistedUserPreferencesRecord(preferences, persistedMetadata),
  );
}
