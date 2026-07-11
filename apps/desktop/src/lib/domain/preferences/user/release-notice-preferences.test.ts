import { describe, expect, it } from "vitest";
import { migrateUserPreferences } from "@/lib/domain/preferences/user/migration";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import type { LegacyUserPreferencesInput } from "@/lib/domain/preferences/user/persisted-keys";

describe("release notice preference migration", () => {
  it("preserves exact normalized version keys and one current cached title", () => {
    const result = migrateUserPreferences({
      ...USER_PREFERENCE_DEFAULTS,
      acknowledgedReleaseVersion: " 0.3.24 ",
      cachedInstalledRelease: {
        version: " 0.3.24 ",
        title: " Faster workspaces ",
      },
    });

    expect(result.preferences).toMatchObject({
      acknowledgedReleaseVersion: "0.3.24",
      cachedInstalledRelease: {
        version: "0.3.24",
        title: "Faster workspaces",
      },
    });
    expect(result.changed).toBe(true);
  });

  it("drops malformed and unbounded release-notice state", () => {
    const input = {
      ...USER_PREFERENCE_DEFAULTS,
      acknowledgedReleaseVersion: 25,
      cachedInstalledRelease: {
        version: "0.3.25",
        title: "x".repeat(81),
      },
    } as unknown as LegacyUserPreferencesInput;

    const result = migrateUserPreferences(input);

    expect(result.preferences.acknowledgedReleaseVersion).toBeNull();
    expect(result.preferences.cachedInstalledRelease).toBeNull();
  });
});
