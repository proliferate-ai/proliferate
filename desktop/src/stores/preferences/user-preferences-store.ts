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
  cloudRuntimeInputSyncEnabled: boolean;
  onboardingCompletedVersion: number;
  onboardingPrimaryGoalId: OnboardingGoalId | "";
}

const USER_PREFERENCES_KEY = "user_preferences";
const LEGACY_THEME_KEY = "proliferate-theme";
const LEGACY_MODE_KEY = "proliferate-mode";

export const USER_PREFERENCE_DEFAULTS: UserPreferences = {
  themePreset: "ship",
  colorMode: "dark",
  defaultChatAgentKind: "",
  defaultChatModelId: "",
  defaultSessionModeByAgentKind: {},
  defaultOpenInTargetId: "",
  branchPrefixType: "none",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  transparentChromeEnabled: true,
  powersInCodingSessionsEnabled: false,
  cloudRuntimeInputSyncEnabled: false,
  onboardingCompletedVersion: 0,
  onboardingPrimaryGoalId: "",
};

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

  return {
    themePreset: legacyTheme.themePreset ?? USER_PREFERENCE_DEFAULTS.themePreset,
    colorMode: legacyTheme.colorMode ?? USER_PREFERENCE_DEFAULTS.colorMode,
    defaultChatAgentKind:
      (await readPersistedValue<string>("defaultChatAgentKind"))
      ?? USER_PREFERENCE_DEFAULTS.defaultChatAgentKind,
    defaultChatModelId:
      (await readPersistedValue<string>("defaultChatModelId"))
      ?? USER_PREFERENCE_DEFAULTS.defaultChatModelId,
    defaultSessionModeByAgentKind: USER_PREFERENCE_DEFAULTS.defaultSessionModeByAgentKind,
    defaultOpenInTargetId:
      (await readPersistedValue<string>("defaultOpenInTargetId"))
      ?? USER_PREFERENCE_DEFAULTS.defaultOpenInTargetId,
    branchPrefixType:
      (await readPersistedValue<BranchPrefixType>("branchPrefixType"))
      ?? USER_PREFERENCE_DEFAULTS.branchPrefixType,
    turnEndSoundEnabled: USER_PREFERENCE_DEFAULTS.turnEndSoundEnabled,
    turnEndSoundId: USER_PREFERENCE_DEFAULTS.turnEndSoundId,
    transparentChromeEnabled: USER_PREFERENCE_DEFAULTS.transparentChromeEnabled,
    powersInCodingSessionsEnabled: USER_PREFERENCE_DEFAULTS.powersInCodingSessionsEnabled,
    cloudRuntimeInputSyncEnabled: USER_PREFERENCE_DEFAULTS.cloudRuntimeInputSyncEnabled,
    onboardingCompletedVersion: USER_PREFERENCE_DEFAULTS.onboardingCompletedVersion,
    onboardingPrimaryGoalId: USER_PREFERENCE_DEFAULTS.onboardingPrimaryGoalId,
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
      ...USER_PREFERENCE_DEFAULTS,
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
    next.branchPrefixType = USER_PREFERENCE_DEFAULTS.branchPrefixType;
    changed = true;
  }

  if (typeof next.transparentChromeEnabled !== "boolean") {
    next.transparentChromeEnabled = USER_PREFERENCE_DEFAULTS.transparentChromeEnabled;
    changed = true;
  }

  if (typeof next.powersInCodingSessionsEnabled !== "boolean") {
    next.powersInCodingSessionsEnabled = USER_PREFERENCE_DEFAULTS.powersInCodingSessionsEnabled;
    changed = true;
  }

  if (typeof next.cloudRuntimeInputSyncEnabled !== "boolean") {
    next.cloudRuntimeInputSyncEnabled = USER_PREFERENCE_DEFAULTS.cloudRuntimeInputSyncEnabled;
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
