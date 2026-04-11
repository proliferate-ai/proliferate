import { describe, expect, it } from "vitest";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";

describe("resolveCoworkDefaultSessionModeId", () => {
  it("returns the vetted cowork default for supported agent families", () => {
    expect(resolveCoworkDefaultSessionModeId("claude")).toBe("bypassPermissions");
    expect(resolveCoworkDefaultSessionModeId("codex")).toBe("full-access");
    expect(resolveCoworkDefaultSessionModeId("gemini")).toBe("yolo");
  });

  it("returns undefined for unresolved agent families", () => {
    expect(resolveCoworkDefaultSessionModeId("cursor")).toBeUndefined();
    expect(resolveCoworkDefaultSessionModeId("opencode")).toBeUndefined();
    expect(resolveCoworkDefaultSessionModeId("amp")).toBeUndefined();
  });

  it("returns undefined for missing agent kinds", () => {
    expect(resolveCoworkDefaultSessionModeId("")).toBeUndefined();
    expect(resolveCoworkDefaultSessionModeId(null)).toBeUndefined();
  });
});
