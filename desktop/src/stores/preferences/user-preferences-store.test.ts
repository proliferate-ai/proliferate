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

  it("sanitizes partially present review defaults", () => {
    const result = migrateUserPreferences({
      ...USER_PREFERENCE_DEFAULTS,
      reviewDefaultsByKind: {
        plan: {
          maxRounds: 9,
          autoSendFeedback: true,
          reviewers: [
            {
              id: "skeptic",
              label: "Skeptic",
              prompt: "Find planning gaps.",
              agentKind: "codex",
              modelId: "gpt-5.4",
              modeId: "read-only",
            },
          ],
        },
        code: null,
      },
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.reviewDefaultsByKind.plan?.maxRounds).toBe(5);
    expect(result.preferences.reviewDefaultsByKind.plan?.reviewers).toHaveLength(1);
    expect(result.preferences.reviewDefaultsByKind.code).toBeNull();
  });

  it("sanitizes reusable review personalities by kind", () => {
    const result = migrateUserPreferences({
      ...USER_PREFERENCE_DEFAULTS,
      reviewPersonalitiesByKind: {
        plan: [
          {
            id: " plan-skeptic ",
            label: " Strict plan reviewer ",
            prompt: " Find hidden plan gaps. ",
          },
          {
            id: "plan-skeptic",
            label: "Duplicate",
            prompt: "Drop duplicate.",
          },
          {
            id: "",
            label: "Missing id",
            prompt: "Drop invalid.",
          },
        ],
        code: null as unknown as [],
      },
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.reviewPersonalitiesByKind.plan).toEqual([
      {
        id: "plan-skeptic",
        label: "Strict plan reviewer",
        prompt: "Find hidden plan gaps.",
      },
    ]);
    expect(result.preferences.reviewPersonalitiesByKind.code).toEqual([]);
  });
});
