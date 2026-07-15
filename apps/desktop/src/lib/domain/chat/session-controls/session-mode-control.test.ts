import { describe, expect, it } from "vitest";
import { resolveSessionControlPresentation } from "./session-mode-control";

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
});
