import { describe, expect, it } from "vitest";
import {
  reasoningLadderTopsOutAtUltra,
  resolveReasoningEffortPresentation,
} from "./session-reasoning-effort-control";

describe("resolveReasoningEffortPresentation", () => {
  it("preserves authored catalog labels over internal spellings", () => {
    expect(resolveReasoningEffortPresentation("xhigh", "Extra High")).toEqual({
      shortLabel: "Extra High",
    });
    expect(resolveReasoningEffortPresentation("max", "Max")).toEqual({
      shortLabel: "Max",
    });
  });

  it("falls back to a readable spelling when no label is authored", () => {
    expect(resolveReasoningEffortPresentation("xhigh", null)).toEqual({
      shortLabel: "X High",
    });
    expect(resolveReasoningEffortPresentation("max", "")).toEqual({
      shortLabel: "X High",
    });
  });
});

describe("reasoningLadderTopsOutAtUltra", () => {
  it("detects an ultra top rung", () => {
    expect(reasoningLadderTopsOutAtUltra([
      { value: "medium" },
      { value: "high" },
      { value: "xhigh" },
      { value: "Ultra" },
    ])).toBe(true);
  });

  it("stays false for ladders without ultra and for degenerate ladders", () => {
    expect(reasoningLadderTopsOutAtUltra([
      { value: "medium" },
      { value: "high" },
      { value: "xhigh" },
    ])).toBe(false);
    expect(reasoningLadderTopsOutAtUltra([{ value: "ultra" }])).toBe(false);
  });
});
