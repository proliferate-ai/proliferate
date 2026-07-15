import { describe, expect, it } from "vitest";
import { resolveUnattendedModeId } from "@/lib/domain/agents/unattended-mode";

describe("resolveUnattendedModeId", () => {
  it("returns the catalog's curated unattended mode for vetted families", () => {
    expect(resolveUnattendedModeId("claude")).toBe("bypassPermissions");
    expect(resolveUnattendedModeId("codex")).toBe("full-access");
  });

  it("returns undefined for families that declare none", () => {
    // Grok has no mode control at all; cursor/opencode are unvetted.
    expect(resolveUnattendedModeId("grok")).toBeUndefined();
    expect(resolveUnattendedModeId("cursor")).toBeUndefined();
    expect(resolveUnattendedModeId("opencode")).toBeUndefined();
  });

  it("returns undefined for missing agent kinds", () => {
    expect(resolveUnattendedModeId("")).toBeUndefined();
    expect(resolveUnattendedModeId("  ")).toBeUndefined();
    expect(resolveUnattendedModeId(null)).toBeUndefined();
    expect(resolveUnattendedModeId(undefined)).toBeUndefined();
  });
});
