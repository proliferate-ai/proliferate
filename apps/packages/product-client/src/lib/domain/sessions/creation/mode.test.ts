import { describe, expect, it } from "vitest";
import { resolveSessionCreationModeId } from "#product/lib/domain/sessions/creation/mode";

describe("resolveSessionCreationModeId", () => {
  it("lets an explicit mode override the stored user default", () => {
    expect(resolveSessionCreationModeId({
      explicitModeId: "bypassPermissions",
      workspaceSurface: "coding",
      unattendedModeId: "acceptEdits",
      preferredModeId: "plan",
    })).toBe("bypassPermissions");
  });

  it("lets an explicit mode override the cowork default", () => {
    expect(resolveSessionCreationModeId({
      explicitModeId: "default",
      workspaceSurface: "cowork",
      unattendedModeId: "bypassPermissions",
      preferredModeId: "plan",
    })).toBe("default");
  });

  it("uses the selected catalog default for cowork when no explicit mode is provided", () => {
    expect(resolveSessionCreationModeId({
      workspaceSurface: "cowork",
      unattendedModeId: "full-access",
      preferredModeId: "read-only",
    })).toBe("full-access");
  });

  it("omits cowork mode when the selected agent declares no unattended default", () => {
    expect(resolveSessionCreationModeId({
      workspaceSurface: "cowork",
      unattendedModeId: null,
      preferredModeId: "read-only",
    })).toBeUndefined();
  });

  it("falls back to the stored user default outside cowork", () => {
    expect(resolveSessionCreationModeId({
      workspaceSurface: "coding",
      unattendedModeId: "full-access",
      preferredModeId: "auto",
    })).toBe("auto");
  });
});
