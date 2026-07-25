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
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

const storeMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => {
    const value = values.get(key);
    return value === undefined ? null : JSON.stringify(value);
  });
  const set = vi.fn(async (key: string, value: string) => {
    values.set(key, JSON.parse(value));
  });
  const remove = vi.fn(async (key: string) => {
    values.delete(key);
  });
  const captureException = vi.fn();

  return {
    values,
    get,
    set,
    remove,
    captureException,
  };
});

const persistence: ProductStorageContext = {
  storage: {
    getItem: storeMocks.get,
    setItem: storeMocks.set,
    removeItem: storeMocks.remove,
  },
  captureException: storeMocks.captureException,
};

async function bootstrapUserPreferencesForTest(): Promise<void> {
  const loaded = await loadUserPreferences(persistence);
  useUserPreferencesStore.getState().hydrate(loaded);
  if (loaded.shouldPersist) {
    await persistUserPreferences(
      loaded.preferences,
      loaded.persistedMetadata,
      persistence,
    );
  }
}

describe("user appearance preference persistence", () => {
  beforeEach(() => {
    storeMocks.values.clear();
    storeMocks.get.mockClear();
    storeMocks.set.mockClear();
    storeMocks.remove.mockClear();
    storeMocks.captureException.mockClear();
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
      persistence,
    );

    const persisted = storeMocks.values.get("user_preferences") as Record<string, unknown>;
    expect(persisted.uiFontSizeId).toBe("xxsmall");
    expect(persisted.readableCodeFontSizeId).toBe("xxxlarge");
    expect(persisted.windowZoomId).toBe("zoom120");
    expect(persisted.turnEndSoundEnabled).toBe(true);
  });
});
