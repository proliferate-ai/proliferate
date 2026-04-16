import { describe, expect, it } from "vitest";
import {
  migrateUserPreferences,
  USER_PREFERENCE_DEFAULTS,
} from "@/stores/preferences/user-preferences-store";

describe("user preference migration", () => {
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
});
