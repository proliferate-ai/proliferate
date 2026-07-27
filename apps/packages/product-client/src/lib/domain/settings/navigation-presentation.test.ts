import { describe, expect, it } from "vitest";
import {
  getSettingsScopeNav,
  getSettingsSectionForHarnessKind,
  isSettingsAdminOnlyScope,
  isSettingsHarnessSection,
  SETTINGS_SCOPE_ORDER,
} from "#product/lib/domain/settings/navigation-presentation";

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

describe("cursor's per-harness settings section (C1 nav-wiring fix)", () => {
  it("registers agent-cursor in the Agents scope nav", () => {
    const agentsNav = getSettingsScopeNav("agents");
    const sectionIds = agentsNav.groups.flatMap((group) =>
      group.items.flatMap((item) => (item.kind === "section" ? [item.id] : []))
    );
    expect(sectionIds).toContain("agent-cursor");
  });

  it("maps agent-cursor to the cursor harness kind and back", () => {
    expect(isSettingsHarnessSection("agent-cursor")).toBe(true);
    expect(getSettingsSectionForHarnessKind("cursor")).toBe("agent-cursor");
  });
});
