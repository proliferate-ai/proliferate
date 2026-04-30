import { create } from "zustand";
import type { ColorMode, ThemePreset } from "@/config/theme";
import type { OnboardingGoalId } from "@/config/onboarding";
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
  onboardingCompletedVersion: number;
  onboardingPrimaryGoalId: OnboardingGoalId | "";
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
  onboardingCompletedVersion: 0,
  onboardingPrimaryGoalId: "",
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
  onboardingCompletedVersion: 0,
  onboardingPrimaryGoalId: "",
};

export const USER_PREFERENCE_DEFAULTS = NEW_USER_DEFAULTS;

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
    onboardingCompletedVersion: defaults.onboardingCompletedVersion,
    onboardingPrimaryGoalId: defaults.onboardingPrimaryGoalId,
  };
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

async function readAll(): Promise<UserPreferences> {
  const persisted = await readPersistedValue<UserPreferences>(USER_PREFERENCES_KEY);
  if (persisted) {
    return {
      ...PERSISTED_RECORD_BACKFILL,
      ...persisted,
    };
  }

  return readLegacyUserPreferences();
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
    onboardingCompletedVersion: state.onboardingCompletedVersion,
    onboardingPrimaryGoalId: state.onboardingPrimaryGoalId,
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
    void persistValue(USER_PREFERENCES_KEY, currentSlice);
  }
});

export async function bootstrapUserPreferences(): Promise<void> {
  const persisted = await readAll();
  const migrated = migrateUserPreferences(persisted);
  useUserPreferencesStore.setState({
    ...migrated.preferences,
    _hydrated: true,
  });
  if (migrated.changed) {
    void persistValue(USER_PREFERENCES_KEY, migrated.preferences);
  }
}
