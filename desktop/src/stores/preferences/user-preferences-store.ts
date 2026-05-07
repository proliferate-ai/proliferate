import { create } from "zustand";
import {
  getForwardCompatibleUserPreferenceExtras,
  hasDeprecatedUserPreferenceKeys,
  isValidWorktreeAutoDeleteLimit,
  migrateUserPreferences,
  NEW_USER_DEFAULTS,
  PERSISTED_RECORD_BACKFILL,
  pickLegacyUserPreferencesInput,
  USER_PREFERENCE_DEFAULTS,
  type BranchPrefixType,
  type LegacyUserPreferencesInput,
  type UserPreferences,
} from "@/lib/domain/preferences/user-preferences";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";

export {
  migrateUserPreferences,
  NEW_USER_DEFAULTS,
  PERSISTED_RECORD_BACKFILL,
  USER_PREFERENCE_DEFAULTS,
  WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
  WORKTREE_AUTO_DELETE_LIMIT_MAX,
  WORKTREE_AUTO_DELETE_LIMIT_MIN,
} from "@/lib/domain/preferences/user-preferences";
export type {
  BranchPrefixType,
  DefaultLiveSessionControlKey,
  DefaultLiveSessionControlValuesByAgentKind,
  ReviewDefaultKind,
  ReviewDefaultsByKind,
  ReviewKindPreference,
  ReviewPersonaPreference,
  ReviewPersonalitiesByKind,
  TurnEndSoundId,
  UserPreferences,
} from "@/lib/domain/preferences/user-preferences";

const USER_PREFERENCES_KEY = "user_preferences";
const LEGACY_THEME_KEY = "proliferate-theme";
const LEGACY_MODE_KEY = "proliferate-mode";
const WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY = "worktreeAutoDeleteLimitBackfilled";

let persistedPreferenceExtras: Record<string, unknown> = {};

type LegacyThemeRecord = Pick<Partial<UserPreferences>, "themePreset" | "colorMode">;

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

async function readAll(): Promise<{
  preferences: LegacyUserPreferencesInput;
  shouldPersist: boolean;
  extras: Record<string, unknown>;
  deferWorktreeAutoDeleteLimitPersist: boolean;
}> {
  const persisted = await readPersistedValue<Record<string, unknown>>(USER_PREFERENCES_KEY);
  if (persisted && typeof persisted === "object" && !Array.isArray(persisted)) {
    const needsWorktreeAdoption = !isValidWorktreeAutoDeleteLimit(
      persisted.worktreeAutoDeleteLimit,
    );
    const extras = getForwardCompatibleUserPreferenceExtras(persisted);
    if (needsWorktreeAdoption) {
      extras[WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY] = true;
    }
    return {
      preferences: pickLegacyUserPreferencesInput(persisted),
      shouldPersist: hasDeprecatedUserPreferenceKeys(persisted),
      extras,
      deferWorktreeAutoDeleteLimitPersist: needsWorktreeAdoption,
    };
  }

  return {
    preferences: await readLegacyUserPreferences(),
    shouldPersist: false,
    extras: {},
    deferWorktreeAutoDeleteLimitPersist: false,
  };
}

interface UserPreferencesState extends UserPreferences {
  _hydrated: boolean;
  set: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  setMultiple: (partial: Partial<UserPreferences>) => void;
}

function selectPersistedSlice(state: UserPreferencesState): UserPreferences {
  return {
    themePreset: state.themePreset,
    colorMode: state.colorMode,
    uiFontSizeId: state.uiFontSizeId,
    readableCodeFontSizeId: state.readableCodeFontSizeId,
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultLiveSessionControlValuesByAgentKind:
      state.defaultLiveSessionControlValuesByAgentKind,
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    branchPrefixType: state.branchPrefixType,
    turnEndSoundEnabled: state.turnEndSoundEnabled,
    turnEndSoundId: state.turnEndSoundId,
    transparentChromeEnabled: state.transparentChromeEnabled,
    pluginsInCodingSessionsEnabled: state.pluginsInCodingSessionsEnabled,
    subagentsEnabled: state.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: state.cloudRuntimeInputSyncEnabled,
    worktreeAutoDeleteLimit: state.worktreeAutoDeleteLimit,
    pasteAttachmentsEnabled: state.pasteAttachmentsEnabled,
    reviewDefaultsByKind: state.reviewDefaultsByKind,
    reviewPersonalitiesByKind: state.reviewPersonalitiesByKind,
  };
}

function buildPersistedPreferencesRecord(
  preferences: UserPreferences,
): Record<string, unknown> {
  const {
    worktreeAutoDeleteLimit,
    ...preferencesWithoutWorktreeAutoDeleteLimit
  } = preferences;
  return {
    ...persistedPreferenceExtras,
    ...(hasPendingWorktreeAutoDeleteLimitAdoption()
      ? preferencesWithoutWorktreeAutoDeleteLimit
      : { ...preferencesWithoutWorktreeAutoDeleteLimit, worktreeAutoDeleteLimit }),
  };
}

export const useUserPreferencesStore = create<UserPreferencesState>((set) => ({
  ...USER_PREFERENCE_DEFAULTS,
  _hydrated: false,

  set: (key, value) => set({ [key]: value } as Partial<UserPreferencesState>),
  setMultiple: (partial) => set(partial as Partial<UserPreferencesState>),
}));

useUserPreferencesStore.subscribe((state, prev) => {
  if (!state._hydrated) {
    return;
  }

  const currentSlice = selectPersistedSlice(state);
  const previousSlice = selectPersistedSlice(prev);
  if (JSON.stringify(currentSlice) !== JSON.stringify(previousSlice)) {
    void persistValue(USER_PREFERENCES_KEY, buildPersistedPreferencesRecord(currentSlice));
  }
});

export async function bootstrapUserPreferences(): Promise<void> {
  const persisted = await readAll();
  persistedPreferenceExtras = persisted.extras;
  const migrated = migrateUserPreferences(persisted.preferences);
  useUserPreferencesStore.setState({
    ...migrated.preferences,
    _hydrated: true,
  });
  if (persisted.deferWorktreeAutoDeleteLimitPersist || migrated.changed || persisted.shouldPersist) {
    void persistValue(USER_PREFERENCES_KEY, buildPersistedPreferencesRecord(migrated.preferences));
  }
}

export function hasPendingWorktreeAutoDeleteLimitAdoption(): boolean {
  return persistedPreferenceExtras[WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY] === true;
}

export async function markWorktreeAutoDeleteLimitAdopted(): Promise<void> {
  if (!hasPendingWorktreeAutoDeleteLimitAdoption()) {
    return;
  }
  const { [WORKTREE_AUTO_DELETE_LIMIT_ADOPTION_PENDING_KEY]: _removed, ...nextExtras } =
    persistedPreferenceExtras;
  persistedPreferenceExtras = nextExtras;
  await persistValue(
    USER_PREFERENCES_KEY,
    buildPersistedPreferencesRecord(selectPersistedSlice(useUserPreferencesStore.getState())),
  );
}
