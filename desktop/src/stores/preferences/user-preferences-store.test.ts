import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_PRESETS } from "@/config/theme";
import {
  bootstrapUserPreferences,
  migrateUserPreferences,
  PERSISTED_RECORD_BACKFILL,
  USER_PREFERENCE_DEFAULTS,
  useUserPreferencesStore,
  type UserPreferences,
} from "@/stores/preferences/user-preferences-store";

const storeMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => values.get(key));
  const set = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });

  return {
    values,
    get,
    set,
    getPreferencesStore: vi.fn(async () => ({ get, set })),
  };
});

vi.mock("@/platform/tauri/store", () => ({
  getPreferencesStore: storeMocks.getPreferencesStore,
}));

describe("user preference migration", () => {
  beforeEach(() => {
    storeMocks.values.clear();
    storeMocks.get.mockClear();
    storeMocks.set.mockClear();
    storeMocks.getPreferencesStore.mockClear();
    vi.unstubAllGlobals();
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
    });
  });

  it("defaults true new users to Mono dark with transparent chrome disabled", async () => {
    await bootstrapUserPreferences();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.themePreset).toBe("mono");
    expect(preferences.colorMode).toBe("dark");
    expect(preferences.transparentChromeEnabled).toBe(false);
  });

  it("backfills legacy per-key users with old appearance defaults", async () => {
    storeMocks.values.set("defaultChatAgentKind", "claude");

    await bootstrapUserPreferences();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.themePreset).toBe("ship");
    expect(preferences.transparentChromeEnabled).toBe(true);
  });

  it("backfills missing fields in existing unified preferences with old defaults", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      themePreset: "ship",
      transparentChromeEnabled: undefined,
    } as unknown as UserPreferences);

    await bootstrapUserPreferences();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.themePreset).toBe("ship");
    expect(preferences.transparentChromeEnabled).toBe(true);
  });

  it("preserves explicit persisted Ship preferences", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      themePreset: "ship",
      transparentChromeEnabled: true,
    } satisfies UserPreferences);

    await bootstrapUserPreferences();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.themePreset).toBe("ship");
    expect(preferences.transparentChromeEnabled).toBe(true);
  });

  it("strips deprecated onboarding keys from existing unified preferences", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      futurePreference: true,
      onboardingCompletedVersion: 1,
      onboardingPrimaryGoalId: "build",
    } as unknown as UserPreferences);

    await bootstrapUserPreferences();
    await Promise.resolve();
    await Promise.resolve();

    const state = useUserPreferencesStore.getState() as unknown as Record<string, unknown>;
    expect(state.onboardingCompletedVersion).toBeUndefined();
    expect(state.onboardingPrimaryGoalId).toBeUndefined();

    const persisted = storeMocks.values.get("user_preferences") as Record<string, unknown>;
    expect(persisted.futurePreference).toBe(true);
    expect(persisted.onboardingCompletedVersion).toBeUndefined();
    expect(persisted.onboardingPrimaryGoalId).toBeUndefined();
  });

  it("does not rewrite records only because they contain unrelated unknown keys", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      futurePreference: true,
    } as unknown as UserPreferences);

    await bootstrapUserPreferences();
    await Promise.resolve();
    await Promise.resolve();

    expect(storeMocks.set).not.toHaveBeenCalled();
  });

  it("preserves unrelated unknown keys when hydration rewrites known preferences", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      themePreset: "ship",
      futurePreference: true,
    } as unknown as UserPreferences);

    await bootstrapUserPreferences();
    await Promise.resolve();
    await Promise.resolve();

    const persisted = storeMocks.values.get("user_preferences") as Record<string, unknown>;
    expect(persisted.themePreset).toBe("ship");
    expect(persisted.futurePreference).toBe(true);
  });

  it("preserves unrelated unknown keys when migrating known preferences", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      branchPrefixType: "invalid",
      futurePreference: true,
    } as unknown as UserPreferences);

    await bootstrapUserPreferences();
    await Promise.resolve();
    await Promise.resolve();

    const persisted = storeMocks.values.get("user_preferences") as Record<string, unknown>;
    expect(persisted.branchPrefixType).toBe(PERSISTED_RECORD_BACKFILL.branchPrefixType);
    expect(persisted.futurePreference).toBe(true);
  });

  it("orders Mono before Dominic in theme preset options", () => {
    expect(THEME_PRESETS.indexOf("mono")).toBeLessThan(THEME_PRESETS.indexOf("ship"));
  });

  it("keeps existing-record backfills distinct from new-user defaults", () => {
    expect(USER_PREFERENCE_DEFAULTS.themePreset).toBe("mono");
    expect(USER_PREFERENCE_DEFAULTS.transparentChromeEnabled).toBe(false);
    expect(PERSISTED_RECORD_BACKFILL.themePreset).toBe("ship");
    expect(PERSISTED_RECORD_BACKFILL.transparentChromeEnabled).toBe(true);
  });

  it("defaults coding-session Powers to disabled for older preference blobs", () => {
    const { preferences, changed } = migrateUserPreferences({
      ...USER_PREFERENCE_DEFAULTS,
      powersInCodingSessionsEnabled: undefined as unknown as boolean,
    });

    expect(changed).toBe(true);
    expect(preferences.powersInCodingSessionsEnabled).toBe(false);
  });

  it("preserves an explicit coding-session Powers preference", () => {
    const { preferences } = migrateUserPreferences({
      ...USER_PREFERENCE_DEFAULTS,
      powersInCodingSessionsEnabled: true,
    });

    expect(preferences.powersInCodingSessionsEnabled).toBe(true);
  });

  it("defaults runtime input sync off", () => {
    expect(USER_PREFERENCE_DEFAULTS.cloudRuntimeInputSyncEnabled).toBe(false);
  });

  it("migrates missing runtime input sync preference to false", () => {
    const legacy = {
      ...USER_PREFERENCE_DEFAULTS,
      cloudRuntimeInputSyncEnabled: undefined,
    } as unknown as UserPreferences;

    const result = migrateUserPreferences(legacy);

    expect(result.changed).toBe(true);
    expect(result.preferences.cloudRuntimeInputSyncEnabled).toBe(false);
  });

  it("migrates missing transparent chrome through existing-record backfill", () => {
    const legacy = {
      ...USER_PREFERENCE_DEFAULTS,
      transparentChromeEnabled: undefined,
    } as unknown as UserPreferences;

    const result = migrateUserPreferences(legacy);

    expect(result.changed).toBe(true);
    expect(result.preferences.transparentChromeEnabled).toBe(true);
  });
});
