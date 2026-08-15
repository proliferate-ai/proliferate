import { describe, expect, it } from "vitest";
import {
  getSteppedReasoningEffortValue,
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

describe("getSteppedReasoningEffortValue", () => {
  const options = [
    { value: "low", selected: false },
    { value: "medium", selected: true },
    { value: "high", selected: false },
  ];

  it("steps forward to the next option", () => {
    expect(getSteppedReasoningEffortValue(options, 1)).toBe("high");
  });

  it("steps backward to the previous option", () => {
    expect(getSteppedReasoningEffortValue(options, -1)).toBe("low");
  });

  it("wraps forward from the top option back to the bottom", () => {
    const atTop = [
      { value: "low", selected: false },
      { value: "medium", selected: false },
      { value: "high", selected: true },
    ];
    expect(getSteppedReasoningEffortValue(atTop, 1)).toBe("low");
  });

  it("wraps backward from the bottom option to the top", () => {
    const atBottom = [
      { value: "low", selected: true },
      { value: "medium", selected: false },
      { value: "high", selected: false },
    ];
    expect(getSteppedReasoningEffortValue(atBottom, -1)).toBe("high");
  });

  it("treats index 0 as current when nothing is selected", () => {
    const noneSelected = [
      { value: "low", selected: false },
      { value: "medium", selected: false },
      { value: "high", selected: false },
    ];
    expect(getSteppedReasoningEffortValue(noneSelected, 1)).toBe("medium");
    expect(getSteppedReasoningEffortValue(noneSelected, -1)).toBe("high");
  });

  it("returns null for a single-option ladder", () => {
    expect(getSteppedReasoningEffortValue([{ value: "medium", selected: true }], 1)).toBeNull();
    expect(getSteppedReasoningEffortValue([{ value: "medium", selected: true }], -1)).toBeNull();
  });

  it("returns null for an empty ladder", () => {
    expect(getSteppedReasoningEffortValue([], 1)).toBeNull();
    expect(getSteppedReasoningEffortValue([], -1)).toBeNull();
  });
});
