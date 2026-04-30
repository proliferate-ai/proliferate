import { describe, expect, it } from "vitest";
import { resolveSessionCreationModeId } from "@/hooks/sessions/use-session-creation-actions";

describe("resolveSessionCreationModeId", () => {
  it("lets an explicit mode override the stored user default", () => {
    expect(resolveSessionCreationModeId({
      explicitModeId: "bypassPermissions",
      workspaceSurface: "coding",
      agentKind: "claude",
      preferredModeId: "plan",
    })).toBe("bypassPermissions");
  });

  it("lets an explicit mode override the cowork default", () => {
    expect(resolveSessionCreationModeId({
      explicitModeId: "default",
      workspaceSurface: "cowork",
      agentKind: "claude",
      preferredModeId: "plan",
    })).toBe("default");
  });

  it("falls back to the cowork default when no explicit mode is provided", () => {
    expect(resolveSessionCreationModeId({
      workspaceSurface: "cowork",
      agentKind: "codex",
      preferredModeId: "read-only",
    })).toBe("full-access");
  });

  it("falls back to the stored user default outside cowork", () => {
    expect(resolveSessionCreationModeId({
      workspaceSurface: "coding",
      agentKind: "codex",
      preferredModeId: "auto",
    })).toBe("auto");
  });
});
