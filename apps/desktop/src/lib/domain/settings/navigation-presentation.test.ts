import { describe, expect, it } from "vitest";
import {
  isSettingsAdminOnlyScope,
  SETTINGS_SCOPE_ORDER,
} from "@/lib/domain/settings/navigation-presentation";

describe("isSettingsAdminOnlyScope", () => {
  it("flags the org scope as admin-only, since every one of its sections is", () => {
    expect(isSettingsAdminOnlyScope("org")).toBe(true);
  });

  it("does not flag the user, repo, or agents scopes", () => {
    for (const scope of SETTINGS_SCOPE_ORDER) {
      if (scope === "org") {
        continue;
      }
      expect(isSettingsAdminOnlyScope(scope)).toBe(false);
    }
  });
});
