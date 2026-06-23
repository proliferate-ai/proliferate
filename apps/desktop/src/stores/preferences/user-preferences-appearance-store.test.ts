import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markModelVisibilityDefaultsReset,
  selectPersistedUserPreferencesSlice,
} from "@/lib/domain/preferences/persisted-metadata";
import {
  USER_PREFERENCE_DEFAULTS,
  type UserPreferences,
} from "@/lib/domain/preferences/user/model";
import {
  loadUserPreferences,
  persistUserPreferences,
} from "@/lib/workflows/preferences/user-preferences-persistence";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

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

vi.mock("@/lib/access/tauri/store", () => ({
  getPreferencesStore: storeMocks.getPreferencesStore,
}));

async function bootstrapUserPreferencesForTest(): Promise<void> {
  const loaded = await loadUserPreferences();
  useUserPreferencesStore.getState().hydrate(loaded);
  if (loaded.shouldPersist) {
    await persistUserPreferences(loaded.preferences, loaded.persistedMetadata);
  }
}

describe("user appearance preference persistence", () => {
  beforeEach(() => {
    storeMocks.values.clear();
    storeMocks.get.mockClear();
    storeMocks.set.mockClear();
    storeMocks.getPreferencesStore.mockClear();
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
      _persistedMetadata: {},
    });
  });

  it("round-trips the appearance preference bounds", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      ...markModelVisibilityDefaultsReset({}),
      uiFontSizeId: "xxsmall",
      readableCodeFontSizeId: "xxxlarge",
      windowZoomId: "zoom120",
    } as UserPreferences);

    await bootstrapUserPreferencesForTest();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.uiFontSizeId).toBe("xxsmall");
    expect(preferences.readableCodeFontSizeId).toBe("xxxlarge");
    expect(preferences.windowZoomId).toBe("zoom120");
    expect(storeMocks.set).not.toHaveBeenCalled();

    preferences.set("turnEndSoundEnabled", true);
    await persistUserPreferences(
      selectPersistedUserPreferencesSlice(useUserPreferencesStore.getState()),
      useUserPreferencesStore.getState()._persistedMetadata,
    );

    const persisted = storeMocks.values.get("user_preferences") as Record<string, unknown>;
    expect(persisted.uiFontSizeId).toBe("xxsmall");
    expect(persisted.readableCodeFontSizeId).toBe("xxxlarge");
    expect(persisted.windowZoomId).toBe("zoom120");
    expect(persisted.turnEndSoundEnabled).toBe(true);
  });
});
