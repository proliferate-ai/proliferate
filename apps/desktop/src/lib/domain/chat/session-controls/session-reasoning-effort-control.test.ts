import { describe, expect, it } from "vitest";
import { resolveReasoningEffortPresentation } from "./session-reasoning-effort-control";

describe("resolveReasoningEffortPresentation", () => {
  it("normalizes legacy max reasoning to xhigh presentation", () => {
    expect(resolveReasoningEffortPresentation("max", "Max")).toEqual({
      tone: "warning",
      shortLabel: "Xhigh",
    });
  });

  it("uses the canonical xhigh label even when a raw option label is present", () => {
    expect(resolveReasoningEffortPresentation("xhigh", "Extra High")).toEqual({
      tone: "warning",
      shortLabel: "Xhigh",
    });
  });
});
