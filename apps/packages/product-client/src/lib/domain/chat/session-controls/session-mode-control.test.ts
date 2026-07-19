import { describe, expect, it } from "vitest";
import {
  getNextSessionModeValue,
  resolveSessionControlPresentation,
} from "#product/lib/domain/chat/session-controls/session-mode-control";

describe("resolveSessionControlPresentation", () => {
  it.each([
    ["cursor", "agent", "edit"],
    ["cursor", "plan", "plan"],
    ["cursor", "ask", "chat"],
    ["opencode", "build", "opencodeBuild"],
    ["opencode", "plan", "opencodePlan"],
  ] as const)("uses configured icons for %s %s mode", (agentKind, value, icon) => {
    expect(resolveSessionControlPresentation(agentKind, "mode", value).icon).toBe(icon);
  });

  it("steps forward through runtime-provided modes and wraps", () => {
    const options = [
      { value: "default" },
      { value: "plan" },
      { value: "bypass" },
    ];

    expect(getNextSessionModeValue(options, "default")).toBe("plan");
    expect(getNextSessionModeValue(options, "plan")).toBe("bypass");
    expect(getNextSessionModeValue(options, "bypass")).toBe("default");
    expect(getNextSessionModeValue(options, "missing")).toBe("default");
    expect(getNextSessionModeValue([{ value: "only" }], "only")).toBeNull();
  });
});
