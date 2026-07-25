import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasAppliedModelVisibilityDefaultsReset,
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

describe("user model visibility reset", () => {
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

  it("resets existing frontier-agent visibility overrides once", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      chatModelVisibilityOverridesByAgentKind: {
        claude: {
          "us.anthropic.claude-opus-4-8[1m]": false,
        },
        cursor: {
          "composer-2-fast": true,
          "gpt-5.5-extra-high": false,
        },
        opencode: {
          "opencode/ring-2.6-1t-free": true,
        },
      },
    } as unknown as UserPreferences);

    await bootstrapUserPreferencesForTest();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.chatModelVisibilityOverridesByAgentKind).toEqual({
      claude: {
        "us.anthropic.claude-opus-4-8[1m]": false,
      },
    });
    const persisted = storeMocks.values.get("user_preferences") as Record<string, unknown>;
    expect(hasAppliedModelVisibilityDefaultsReset(persisted)).toBe(true);
  });

  it("preserves frontier-agent visibility overrides after the reset marker exists", async () => {
    storeMocks.values.set("user_preferences", {
      ...USER_PREFERENCE_DEFAULTS,
      modelVisibilityDefaults20260531Reset: true,
      chatModelVisibilityOverridesByAgentKind: {
        cursor: {
          "gpt-5.5-extra-high": false,
        },
      },
    } as unknown as UserPreferences);

    await bootstrapUserPreferencesForTest();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.chatModelVisibilityOverridesByAgentKind).toEqual({
      cursor: {
        "gpt-5.5-extra-high": false,
      },
    });
  });

  it("preserves fresh-user frontier-agent visibility overrides after first persist", async () => {
    await bootstrapUserPreferencesForTest();

    useUserPreferencesStore.getState().set("chatModelVisibilityOverridesByAgentKind", {
      cursor: {
        "gpt-5.5-extra-high": false,
      },
    });
    await persistUserPreferences(
      selectPersistedUserPreferencesSlice(useUserPreferencesStore.getState()),
      useUserPreferencesStore.getState()._persistedMetadata,
      persistence,
    );

    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
      _persistedMetadata: {},
    });
    await bootstrapUserPreferencesForTest();

    const preferences = useUserPreferencesStore.getState();
    expect(preferences.chatModelVisibilityOverridesByAgentKind).toEqual({
      cursor: {
        "gpt-5.5-extra-high": false,
      },
    });
  });
});
