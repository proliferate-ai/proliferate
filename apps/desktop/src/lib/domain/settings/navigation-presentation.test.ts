import { describe, expect, it } from "vitest";
import {
  isSettingsAdminOnlyScope,
  resolveAgentSettingsLandingSection,
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

describe("resolveAgentSettingsLandingSection", () => {
  it("prefers the configured harness and falls back to the first known ready harness", () => {
    expect(resolveAgentSettingsLandingSection("codex", ["claude"]))
      .toBe("agent-codex");
    expect(resolveAgentSettingsLandingSection("unknown", ["opencode", "claude"]))
      .toBe("agent-opencode");
  });

  it("lands on the first harness page when no known harness is available", () => {
    expect(resolveAgentSettingsLandingSection(null, ["unknown"]))
      .toBe("agent-claude");
  });
});
