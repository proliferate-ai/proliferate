import { beforeEach, describe, expect, it } from "vitest";
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
import {
  createMemoryProductStorage,
  type MemoryProductStorage,
} from "@/test/product-storage-test-utils";

let memory: MemoryProductStorage;

async function bootstrapUserPreferencesForTest(): Promise<void> {
  const loaded = await loadUserPreferences(memory.context);
  useUserPreferencesStore.getState().hydrate(loaded);
  if (loaded.shouldPersist) {
    await persistUserPreferences(memory.context, loaded.preferences, loaded.persistedMetadata);
  }
}

describe("user model visibility reset", () => {
  beforeEach(() => {
    memory = createMemoryProductStorage();
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
      _persistedMetadata: {},
    });
  });

  it("resets existing frontier-agent visibility overrides once", async () => {
    memory.values.set("user_preferences", {
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
    const persisted = memory.readJson<Record<string, unknown>>("user_preferences")!;
    expect(hasAppliedModelVisibilityDefaultsReset(persisted)).toBe(true);
  });

  it("preserves frontier-agent visibility overrides after the reset marker exists", async () => {
    memory.values.set("user_preferences", {
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
      memory.context,
      selectPersistedUserPreferencesSlice(useUserPreferencesStore.getState()),
      useUserPreferencesStore.getState()._persistedMetadata,
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
