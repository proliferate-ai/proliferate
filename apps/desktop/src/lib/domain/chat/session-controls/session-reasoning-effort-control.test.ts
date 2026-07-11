import { describe, expect, it } from "vitest";
import { resolveReasoningEffortPresentation } from "./session-reasoning-effort-control";

describe("resolveReasoningEffortPresentation", () => {
  it("preserves authored catalog labels", () => {
    expect(resolveReasoningEffortPresentation("max", "Max")).toEqual({
      shortLabel: "Max",
    });
  });

  it("uses a human fallback for xhigh when no label is authored", () => {
    expect(resolveReasoningEffortPresentation("xhigh", "Extra High")).toEqual({
      shortLabel: "Extra High",
    });
    expect(resolveReasoningEffortPresentation("xhigh")).toEqual({
      shortLabel: "Extra High",
    });
    expect(resolveReasoningEffortPresentation("ultra")).toEqual({
      shortLabel: "Ultra",
    });
  });
});
