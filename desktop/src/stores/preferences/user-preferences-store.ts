import { create } from "zustand";
import type { ColorMode, ThemePreset } from "@/config/theme";
import type { OnboardingGoalId } from "@/config/onboarding";
import {
  resolveAppearanceSizeId,
  type ReadableCodeFontSizeId,
  type UiFontSizeId,
} from "@/lib/domain/preferences/appearance";
import {
  clampRounds,
  MAX_REVIEWERS_PER_RUN,
  type ReviewPersonalityPreference,
  type StoredReviewPersonalitiesByKind,
} from "@/lib/domain/reviews/review-config";
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";

export type BranchPrefixType = "none" | "proliferate" | "github_username";
export type TurnEndSoundId = "ding" | "gong";
export type ReviewDefaultKind = "plan" | "code";

export interface ReviewPersonaPreference {
  id: string;
  label: string;
  prompt: string;
  agentKind: string;
  modelId: string;
  modeId: string;
}

export interface ReviewKindPreference {
  maxRounds: number;
  autoIterate: boolean;
  reviewers: ReviewPersonaPreference[];
}

export type ReviewDefaultsByKind = Record<ReviewDefaultKind, ReviewKindPreference | null>;
export type ReviewPersonalitiesByKind = StoredReviewPersonalitiesByKind;

export interface UserPreferences {
  themePreset: ThemePreset;
  colorMode: ColorMode;
  uiFontSizeId: UiFontSizeId;
  readableCodeFontSizeId: ReadableCodeFontSizeId;
  defaultChatAgentKind: string;
  defaultChatModelIdByAgentKind: Record<string, string>;
  defaultSessionModeByAgentKind: Record<string, string>;
  defaultOpenInTargetId: string;
  branchPrefixType: BranchPrefixType;
  turnEndSoundEnabled: boolean;
  turnEndSoundId: TurnEndSoundId;
  transparentChromeEnabled: boolean;
  pluginsInCodingSessionsEnabled: boolean;
  subagentsEnabled: boolean;
  coworkWorkspaceDelegationEnabled: boolean;
  cloudRuntimeInputSyncEnabled: boolean;
  reviewDefaultsByKind: ReviewDefaultsByKind;
  reviewPersonalitiesByKind: ReviewPersonalitiesByKind;
  onboardingCompletedVersion: number;
  onboardingPrimaryGoalId: OnboardingGoalId | "";
}

const USER_PREFERENCES_KEY = "user_preferences";
const LEGACY_THEME_KEY = "proliferate-theme";
const LEGACY_MODE_KEY = "proliferate-mode";

export const NEW_USER_DEFAULTS: UserPreferences = {
  themePreset: "mono",
  colorMode: "dark",
  uiFontSizeId: "default",
  readableCodeFontSizeId: "default",
  defaultChatAgentKind: "",
  defaultChatModelIdByAgentKind: {},
  defaultSessionModeByAgentKind: {},
  defaultOpenInTargetId: "",
  branchPrefixType: "none",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  transparentChromeEnabled: false,
  pluginsInCodingSessionsEnabled: false,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  cloudRuntimeInputSyncEnabled: false,
  reviewDefaultsByKind: {
    plan: null,
    code: null,
  },
  reviewPersonalitiesByKind: {
    plan: [],
    code: [],
  },
  onboardingCompletedVersion: 0,
  onboardingPrimaryGoalId: "",
};

export const PERSISTED_RECORD_BACKFILL: UserPreferences = {
  themePreset: "ship",
  colorMode: "dark",
  uiFontSizeId: "default",
  readableCodeFontSizeId: "default",
  defaultChatAgentKind: "",
  defaultChatModelIdByAgentKind: {},
  defaultSessionModeByAgentKind: {},
  defaultOpenInTargetId: "",
  branchPrefixType: "none",
  turnEndSoundEnabled: false,
  turnEndSoundId: "ding",
  // Existing persisted records keep the legacy transparent chrome default;
  // only fresh installs use the opaque NEW_USER_DEFAULTS value.
  transparentChromeEnabled: true,
  pluginsInCodingSessionsEnabled: false,
  subagentsEnabled: true,
  coworkWorkspaceDelegationEnabled: true,
  cloudRuntimeInputSyncEnabled: false,
  reviewDefaultsByKind: {
    plan: null,
    code: null,
  },
  reviewPersonalitiesByKind: {
    plan: [],
    code: [],
  },
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

type LegacyUserPreferencesInput = Omit<Partial<UserPreferences>, "defaultChatModelIdByAgentKind"> & {
  defaultChatModelId?: unknown;
  defaultChatModelIdByAgentKind?: unknown;
  powersInCodingSessionsEnabled?: unknown;
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
    defaultOpenInTargetId: legacyDefaultOpenInTargetId ?? defaults.defaultOpenInTargetId,
    branchPrefixType: legacyBranchPrefixType ?? defaults.branchPrefixType,
    turnEndSoundEnabled: defaults.turnEndSoundEnabled,
    turnEndSoundId: defaults.turnEndSoundId,
    transparentChromeEnabled: defaults.transparentChromeEnabled,
    pluginsInCodingSessionsEnabled: defaults.pluginsInCodingSessionsEnabled,
    subagentsEnabled: defaults.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: defaults.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: defaults.cloudRuntimeInputSyncEnabled,
    reviewDefaultsByKind: defaults.reviewDefaultsByKind,
    reviewPersonalitiesByKind: defaults.reviewPersonalitiesByKind,
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

function normalizeDefaultChatModelId(agentKind: string, modelId: string): string {
  return agentKind === "claude"
    ? LEGACY_CLAUDE_MODEL_IDS[modelId] ?? modelId
    : modelId;
}

function sanitizeDefaultChatModelIdByAgentKind(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([agentKind, modelId]) => {
      const trimmedAgentKind = agentKind.trim();
      const trimmedModelId = typeof modelId === "string" ? modelId.trim() : "";
      return trimmedAgentKind && trimmedModelId
        ? [[trimmedAgentKind, normalizeDefaultChatModelId(trimmedAgentKind, trimmedModelId)]]
        : [];
    }),
  );
}

function sanitizeReviewDefaultsByKind(value: unknown): ReviewDefaultsByKind {
  const defaults: ReviewDefaultsByKind = { plan: null, code: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  return {
    plan: sanitizeReviewKindPreference((value as Partial<ReviewDefaultsByKind>).plan),
    code: sanitizeReviewKindPreference((value as Partial<ReviewDefaultsByKind>).code),
  };
}

function sanitizeReviewPersonalitiesByKind(value: unknown): ReviewPersonalitiesByKind {
  const defaults: ReviewPersonalitiesByKind = { plan: [], code: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const raw = value as Partial<Record<ReviewDefaultKind, unknown>>;
  return {
    plan: sanitizeReviewPersonalityPreferences(raw.plan),
    code: sanitizeReviewPersonalityPreferences(raw.code),
  };
}

function sanitizeReviewPersonalityPreferences(value: unknown): ReviewPersonalityPreference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeReviewPersonalityPreferences(
    value.flatMap(sanitizeReviewPersonalityPreference),
  );
}

function sanitizeReviewPersonalityPreference(value: unknown): ReviewPersonalityPreference[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = value as Partial<ReviewPersonalityPreference>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!id || !label || !prompt) {
    return [];
  }
  return [{ id, label, prompt }];
}

function sanitizeReviewKindPreference(value: unknown): ReviewKindPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<ReviewKindPreference> & {
    autoSendFeedback?: unknown;
  };
  const maxRounds = typeof raw.maxRounds === "number"
    && Number.isFinite(raw.maxRounds)
    ? clampRounds(raw.maxRounds)
    : 2;
  const reviewers = Array.isArray(raw.reviewers)
    ? raw.reviewers.flatMap(sanitizeReviewPersonaPreference)
    : [];
  return {
    maxRounds,
    autoIterate: typeof raw.autoIterate === "boolean"
      ? raw.autoIterate
      : typeof raw.autoSendFeedback === "boolean"
        ? raw.autoSendFeedback
      : true,
    reviewers: dedupeReviewPersonaPreferences(reviewers).slice(0, MAX_REVIEWERS_PER_RUN),
  };
}

function sanitizeReviewPersonaPreference(value: unknown): ReviewPersonaPreference[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = value as Partial<ReviewPersonaPreference>;
  const id = typeof raw.id === "string" && raw.id.trim()
    ? raw.id.trim()
    : typeof raw.label === "string" && raw.label.trim()
      ? raw.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!id || !label || !prompt) {
    return [];
  }
  return [{
    id,
    label,
    prompt,
    agentKind: typeof raw.agentKind === "string" ? raw.agentKind.trim() : "",
    modelId: typeof raw.modelId === "string" ? raw.modelId.trim() : "",
    modeId: typeof raw.modeId === "string" ? raw.modeId.trim() : "",
  }];
}

function dedupeReviewPersonaPreferences(
  reviewers: ReviewPersonaPreference[],
): ReviewPersonaPreference[] {
  const seen = new Set<string>();
  return reviewers.filter((reviewer) => {
    if (seen.has(reviewer.id)) {
      return false;
    }
    seen.add(reviewer.id);
    return true;
  });
}

function dedupeReviewPersonalityPreferences(
  personalities: ReviewPersonalityPreference[],
): ReviewPersonalityPreference[] {
  const seen = new Set<string>();
  return personalities.filter((personality) => {
    if (seen.has(personality.id)) {
      return false;
    }
    seen.add(personality.id);
    return true;
  });
}

async function readAll(): Promise<LegacyUserPreferencesInput> {
  const persisted = await readPersistedValue<LegacyUserPreferencesInput>(USER_PREFERENCES_KEY);
  if (persisted) {
    return persisted;
  }

  return readLegacyUserPreferences();
}

export function migrateUserPreferences(preferences: LegacyUserPreferencesInput): {
  preferences: UserPreferences;
  changed: boolean;
} {
  const rawPreferences = preferences;
  const legacyPowersPreference = rawPreferences.powersInCodingSessionsEnabled;
  const hasCurrentPluginsPreference =
    typeof rawPreferences.pluginsInCodingSessionsEnabled === "boolean";
  const hasLegacyPowersPreference =
    typeof legacyPowersPreference === "boolean";
  const {
    defaultChatModelId,
    defaultChatModelIdByAgentKind,
    ...preferencesWithoutLegacyModel
  } = preferences;
  const next = {
    ...PERSISTED_RECORD_BACKFILL,
    ...preferencesWithoutLegacyModel,
    defaultChatModelIdByAgentKind: {},
  } as UserPreferences & { powersInCodingSessionsEnabled?: unknown };
  let changed = false;

  const sanitizedDefaultChatAgentKind = typeof next.defaultChatAgentKind === "string"
    ? next.defaultChatAgentKind.trim()
    : PERSISTED_RECORD_BACKFILL.defaultChatAgentKind;
  if (sanitizedDefaultChatAgentKind !== next.defaultChatAgentKind) {
    next.defaultChatAgentKind = sanitizedDefaultChatAgentKind;
    changed = true;
  }

  const sanitizedDefaultChatModelIdByAgentKind = sanitizeDefaultChatModelIdByAgentKind(
    defaultChatModelIdByAgentKind,
  );
  if (
    defaultChatModelIdByAgentKind === undefined
    || JSON.stringify(sanitizedDefaultChatModelIdByAgentKind)
      !== JSON.stringify(defaultChatModelIdByAgentKind)
  ) {
    changed = true;
  }
  next.defaultChatModelIdByAgentKind = sanitizedDefaultChatModelIdByAgentKind;

  if (defaultChatModelId !== undefined) {
    changed = true;
    const legacyModelId = typeof defaultChatModelId === "string"
      ? defaultChatModelId.trim()
      : "";
    if (
      next.defaultChatAgentKind
      && legacyModelId
      && !next.defaultChatModelIdByAgentKind[next.defaultChatAgentKind]
    ) {
      next.defaultChatModelIdByAgentKind = {
        ...next.defaultChatModelIdByAgentKind,
        [next.defaultChatAgentKind]: normalizeDefaultChatModelId(
          next.defaultChatAgentKind,
          legacyModelId,
        ),
      };
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

  if (!hasCurrentPluginsPreference) {
    // "Powers" was the old product name. Read the legacy persisted key once,
    // then write future records with the current "plugins" store field.
    next.pluginsInCodingSessionsEnabled =
      hasLegacyPowersPreference
        ? legacyPowersPreference
        : PERSISTED_RECORD_BACKFILL.pluginsInCodingSessionsEnabled;
    changed = true;
  }
  if ("powersInCodingSessionsEnabled" in rawPreferences) {
    delete next.powersInCodingSessionsEnabled;
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

  const uiFontSizeId = resolveAppearanceSizeId(next.uiFontSizeId);
  if (uiFontSizeId !== next.uiFontSizeId) {
    next.uiFontSizeId = uiFontSizeId;
    changed = true;
  }

  const readableCodeFontSizeId = resolveAppearanceSizeId(next.readableCodeFontSizeId);
  if (readableCodeFontSizeId !== next.readableCodeFontSizeId) {
    next.readableCodeFontSizeId = readableCodeFontSizeId;
    changed = true;
  }

  const sanitizedReviewDefaultsByKind = sanitizeReviewDefaultsByKind(next.reviewDefaultsByKind);
  if (JSON.stringify(sanitizedReviewDefaultsByKind) !== JSON.stringify(next.reviewDefaultsByKind)) {
    next.reviewDefaultsByKind = sanitizedReviewDefaultsByKind;
    changed = true;
  }

  const sanitizedReviewPersonalitiesByKind = sanitizeReviewPersonalitiesByKind(
    next.reviewPersonalitiesByKind,
  );
  if (
    JSON.stringify(sanitizedReviewPersonalitiesByKind)
    !== JSON.stringify(next.reviewPersonalitiesByKind)
  ) {
    next.reviewPersonalitiesByKind = sanitizedReviewPersonalitiesByKind;
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
    uiFontSizeId: state.uiFontSizeId,
    readableCodeFontSizeId: state.readableCodeFontSizeId,
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    branchPrefixType: state.branchPrefixType,
    turnEndSoundEnabled: state.turnEndSoundEnabled,
    turnEndSoundId: state.turnEndSoundId,
    transparentChromeEnabled: state.transparentChromeEnabled,
    pluginsInCodingSessionsEnabled: state.pluginsInCodingSessionsEnabled,
    subagentsEnabled: state.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
    cloudRuntimeInputSyncEnabled: state.cloudRuntimeInputSyncEnabled,
    reviewDefaultsByKind: state.reviewDefaultsByKind,
    reviewPersonalitiesByKind: state.reviewPersonalitiesByKind,
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
