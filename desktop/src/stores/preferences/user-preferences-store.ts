import { create } from "zustand";
import type { ColorMode, ThemePreset } from "@/config/theme";
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";

export type BranchPrefixType = "none" | "proliferate" | "github_username";
export type TurnEndSoundId = "ding" | "gong";

export interface UserPreferences {
  themePreset: ThemePreset;
  colorMode: ColorMode;
  defaultChatAgentKind: string;
  defaultChatModelId: string;
  defaultSessionModeByAgentKind: Record<string, string>;
  defaultOpenInTargetId: string;
  branchPrefixType: BranchPrefixType;
  turnEndSoundEnabled: boolean;
  turnEndSoundId: TurnEndSoundId;
  transparentChromeEnabled: boolean;
  powersInCodingSessionsEnabled: boolean;
  subagentsEnabled: boolean;
  coworkWorkspaceDelegationEnabled: boolean;
  cloudRuntimeInputSyncEnabled: boolean;
}

const USER_PREFERENCES_KEY = "user_preferences";
const LEGACY_THEME_KEY = "proliferate-theme";
const LEGACY_MODE_KEY = "proliferate-mode";

export const NEW_USER_DEFAULTS: UserPreferences = {
  themePreset: "mono",
  colorMode: "dark",
  defaultChatAgentKind: "",
  defaultChatModelId: "",
  defaultSessionModeByAgentKind: {},
  defaultOpenInTargetId: "",
  branchPrefixType: "none",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  transparentChromeEnabled: false,
  powersInCodingSessionsEnabled: false,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  cloudRuntimeInputSyncEnabled: false,
};

export const PERSISTED_RECORD_BACKFILL: UserPreferences = {
  themePreset: "ship",
  colorMode: "dark",
  defaultChatAgentKind: "",
  defaultChatModelId: "",
  defaultSessionModeByAgentKind: {},
  defaultOpenInTargetId: "",
  branchPrefixType: "none",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  // Existing persisted records keep the legacy transparent chrome default;
  // only fresh installs use the opaque NEW_USER_DEFAULTS value.
  transparentChromeEnabled: true,
  powersInCodingSessionsEnabled: false,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  cloudRuntimeInputSyncEnabled: false,
};

export const USER_PREFERENCE_DEFAULTS = NEW_USER_DEFAULTS;

const USER_PREFERENCE_KEYS = [
  "themePreset",
  "colorMode",
  "defaultChatAgentKind",
  "defaultChatModelId",
  "defaultSessionModeByAgentKind",
  "defaultOpenInTargetId",
  "branchPrefixType",
  "turnEndSoundEnabled",
  "turnEndSoundId",
  "transparentChromeEnabled",
  "powersInCodingSessionsEnabled",
  "subagentsEnabled",
  "coworkWorkspaceDelegationEnabled",
  "cloudRuntimeInputSyncEnabled",
] as const satisfies readonly (keyof UserPreferences)[];

const USER_PREFERENCE_KEY_SET = new Set<string>(USER_PREFERENCE_KEYS);

const DEPRECATED_USER_PREFERENCE_KEYS = [
  "onboardingCompletedVersion",
  "onboardingPrimaryGoalId",
] as const;

const DEPRECATED_USER_PREFERENCE_KEY_SET = new Set<string>(DEPRECATED_USER_PREFERENCE_KEYS);

let persistedPreferenceExtras: Record<string, unknown> = {};

const LEGACY_CLAUDE_MODEL_IDS: Record<string, string> = {
  "claude-sonnet-4-5": "sonnet",
  "claude-sonnet-4-6": "sonnet",
  "claude-sonnet-4-5-1m": "sonnet[1m]",
  "claude-sonnet-4-6-1m": "sonnet[1m]",
  "claude-opus-4-5": "opus[1m]",
  "claude-opus-4-5-1m": "opus[1m]",
  "claude-opus-4-6": "opus[1m]",
  "claude-opus-4-6-1m": "opus[1m]",
  "claude-haiku-4-5": "haiku",
  opus: "opus[1m]",
};

type LegacyThemeRecord = {
  themePreset?: ThemePreset;
  colorMode?: ColorMode;
};

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

async function readLegacyUserPreferences(): Promise<UserPreferences> {
  const legacyTheme = readLegacyThemeRecord();
  const legacyDefaultChatAgentKind = await readPersistedValue<string>("defaultChatAgentKind");
  const legacyDefaultChatModelId = await readPersistedValue<string>("defaultChatModelId");
  const legacyDefaultOpenInTargetId = await readPersistedValue<string>("defaultOpenInTargetId");
  const legacyBranchPrefixType = await readPersistedValue<BranchPrefixType>("branchPrefixType");
  const hasLegacyPreference =
    legacyTheme.themePreset !== undefined
    || legacyTheme.colorMode !== undefined
    || legacyDefaultChatAgentKind !== undefined
    || legacyDefaultChatModelId !== undefined
    || legacyDefaultOpenInTargetId !== undefined
    || legacyBranchPrefixType !== undefined;
  const defaults = hasLegacyPreference ? PERSISTED_RECORD_BACKFILL : NEW_USER_DEFAULTS;

  return {
    themePreset: legacyTheme.themePreset ?? defaults.themePreset,
    colorMode: legacyTheme.colorMode ?? defaults.colorMode,
    defaultChatAgentKind: legacyDefaultChatAgentKind ?? defaults.defaultChatAgentKind,
    defaultChatModelId: legacyDefaultChatModelId ?? defaults.defaultChatModelId,
    defaultSessionModeByAgentKind: defaults.defaultSessionModeByAgentKind,
    defaultOpenInTargetId: legacyDefaultOpenInTargetId ?? defaults.defaultOpenInTargetId,
    branchPrefixType: legacyBranchPrefixType ?? defaults.branchPrefixType,
    turnEndSoundEnabled: defaults.turnEndSoundEnabled,
    turnEndSoundId: defaults.turnEndSoundId,
    transparentChromeEnabled: defaults.transparentChromeEnabled,
    powersInCodingSessionsEnabled: defaults.powersInCodingSessionsEnabled,
    subagentsEnabled: defaults.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: defaults.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: defaults.cloudRuntimeInputSyncEnabled,
  };
}

function pickUserPreferences(preferences: UserPreferences): UserPreferences {
  return {
    themePreset: preferences.themePreset,
    colorMode: preferences.colorMode,
    defaultChatAgentKind: preferences.defaultChatAgentKind,
    defaultChatModelId: preferences.defaultChatModelId,
    defaultSessionModeByAgentKind: preferences.defaultSessionModeByAgentKind,
    defaultOpenInTargetId: preferences.defaultOpenInTargetId,
    branchPrefixType: preferences.branchPrefixType,
    turnEndSoundEnabled: preferences.turnEndSoundEnabled,
    turnEndSoundId: preferences.turnEndSoundId,
    transparentChromeEnabled: preferences.transparentChromeEnabled,
    powersInCodingSessionsEnabled: preferences.powersInCodingSessionsEnabled,
    subagentsEnabled: preferences.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: preferences.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: preferences.cloudRuntimeInputSyncEnabled,
  };
}

function hasDeprecatedUserPreferenceKeys(value: Record<string, unknown>): boolean {
  return DEPRECATED_USER_PREFERENCE_KEYS.some((key) => key in value);
}

function getForwardCompatibleUserPreferenceExtras(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => (
      !USER_PREFERENCE_KEY_SET.has(key)
      && !DEPRECATED_USER_PREFERENCE_KEY_SET.has(key)
    )),
  );
}

function sanitizeDefaultSessionModeByAgentKind(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, modeId]) => (
      typeof modeId === "string" && agentKind.trim().length > 0 && modeId.trim().length > 0
        ? [[agentKind, modeId]]
        : []
    )),
  );
}

async function readAll(): Promise<{
  preferences: UserPreferences;
  shouldPersist: boolean;
  extras: Record<string, unknown>;
}> {
  const persisted = await readPersistedValue<Record<string, unknown>>(USER_PREFERENCES_KEY);
  if (persisted && typeof persisted === "object" && !Array.isArray(persisted)) {
    return {
      preferences: pickUserPreferences({
        ...PERSISTED_RECORD_BACKFILL,
        ...persisted,
      } as UserPreferences),
      shouldPersist: hasDeprecatedUserPreferenceKeys(persisted),
      extras: getForwardCompatibleUserPreferenceExtras(persisted),
    };
  }

  return {
    preferences: await readLegacyUserPreferences(),
    shouldPersist: false,
    extras: {},
  };
}

export function migrateUserPreferences(preferences: UserPreferences): {
  preferences: UserPreferences;
  changed: boolean;
} {
  const next = { ...preferences };
  let changed = false;

  if (next.defaultChatAgentKind === "claude") {
    const migratedModelId = LEGACY_CLAUDE_MODEL_IDS[next.defaultChatModelId];
    if (migratedModelId && migratedModelId !== next.defaultChatModelId) {
      next.defaultChatModelId = migratedModelId;
      changed = true;
    }
  }

  if (
    next.branchPrefixType !== "none"
    && next.branchPrefixType !== "proliferate"
    && next.branchPrefixType !== "github_username"
  ) {
    next.branchPrefixType = PERSISTED_RECORD_BACKFILL.branchPrefixType;
    changed = true;
  }

  if (typeof next.transparentChromeEnabled !== "boolean") {
    next.transparentChromeEnabled = PERSISTED_RECORD_BACKFILL.transparentChromeEnabled;
    changed = true;
  }

  if (typeof next.powersInCodingSessionsEnabled !== "boolean") {
    next.powersInCodingSessionsEnabled = PERSISTED_RECORD_BACKFILL.powersInCodingSessionsEnabled;
    changed = true;
  }

  if (typeof next.subagentsEnabled !== "boolean") {
    next.subagentsEnabled = PERSISTED_RECORD_BACKFILL.subagentsEnabled;
    changed = true;
  }

  if (typeof next.coworkWorkspaceDelegationEnabled !== "boolean") {
    next.coworkWorkspaceDelegationEnabled = PERSISTED_RECORD_BACKFILL.coworkWorkspaceDelegationEnabled;
    changed = true;
  }

  if (typeof next.cloudRuntimeInputSyncEnabled !== "boolean") {
    next.cloudRuntimeInputSyncEnabled = PERSISTED_RECORD_BACKFILL.cloudRuntimeInputSyncEnabled;
    changed = true;
  }

  const sanitizedDefaultSessionModeByAgentKind = sanitizeDefaultSessionModeByAgentKind(
    next.defaultSessionModeByAgentKind,
  );
  if (
    JSON.stringify(sanitizedDefaultSessionModeByAgentKind)
    !== JSON.stringify(next.defaultSessionModeByAgentKind)
  ) {
    next.defaultSessionModeByAgentKind = sanitizedDefaultSessionModeByAgentKind;
    changed = true;
  }

  return { preferences: next, changed };
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
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    branchPrefixType: state.branchPrefixType,
    turnEndSoundEnabled: state.turnEndSoundEnabled,
    turnEndSoundId: state.turnEndSoundId,
    transparentChromeEnabled: state.transparentChromeEnabled,
    powersInCodingSessionsEnabled: state.powersInCodingSessionsEnabled,
    subagentsEnabled: state.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: state.cloudRuntimeInputSyncEnabled,
  };
}

function buildPersistedPreferencesRecord(
  preferences: UserPreferences,
): Record<string, unknown> {
  return {
    ...persistedPreferenceExtras,
    ...preferences,
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
  if (migrated.changed || persisted.shouldPersist) {
    void persistValue(USER_PREFERENCES_KEY, buildPersistedPreferencesRecord(migrated.preferences));
  }
}
