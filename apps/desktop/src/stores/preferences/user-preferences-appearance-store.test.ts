import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
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
import {
  createMemoryProductStorage,
  type MemoryProductStorage,
} from "@/test/product-storage-test-utils";

let memory: MemoryProductStorage;
let setItemSpy: MockInstance;

async function bootstrapUserPreferencesForTest(): Promise<void> {
  const loaded = await loadUserPreferences(memory.context);
  useUserPreferencesStore.getState().hydrate(loaded);
  if (loaded.shouldPersist) {
    await persistUserPreferences(memory.context, loaded.preferences, loaded.persistedMetadata);
  }
}

describe("user appearance preference persistence", () => {
  beforeEach(() => {
    memory = createMemoryProductStorage();
    setItemSpy = vi.spyOn(memory.storage, "setItem");
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
      _persistedMetadata: {},
    });
  });

  it("round-trips the appearance preference bounds", async () => {
    memory.values.set("user_preferences", {
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
    expect(setItemSpy).not.toHaveBeenCalled();

    preferences.set("turnEndSoundEnabled", true);
    await persistUserPreferences(
      memory.context,
      selectPersistedUserPreferencesSlice(useUserPreferencesStore.getState()),
      useUserPreferencesStore.getState()._persistedMetadata,
    );

    const persisted = memory.readJson<Record<string, unknown>>("user_preferences")!;
    expect(persisted.uiFontSizeId).toBe("xxsmall");
    expect(persisted.readableCodeFontSizeId).toBe("xxxlarge");
    expect(persisted.windowZoomId).toBe("zoom120");
    expect(persisted.turnEndSoundEnabled).toBe(true);
  });
});
