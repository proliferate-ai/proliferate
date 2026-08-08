import { describe, expect, it } from "vitest";
import { resolveSessionCreationModeId } from "#product/lib/domain/sessions/creation/mode";

describe("resolveSessionCreationModeId", () => {
  it("lets an explicit mode override the stored user default", () => {
    expect(resolveSessionCreationModeId({
      explicitModeId: "bypassPermissions",
      preferredModeId: "plan",
    })).toBe("bypassPermissions");
  });

  it("falls back to the stored user default", () => {
    expect(resolveSessionCreationModeId({
      preferredModeId: "auto",
    })).toBe("auto");
  });

  it("omits the mode when nothing is selected or stored", () => {
    expect(resolveSessionCreationModeId({})).toBeUndefined();
  });
});
