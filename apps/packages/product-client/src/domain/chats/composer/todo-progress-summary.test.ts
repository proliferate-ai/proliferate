import { describe, expect, it } from "vitest";
import type { PlanEntry } from "@anyharness/sdk";
import { hasTodoStepAdvanced, summarizeTodoProgress } from "./todo-progress-summary";

describe("summarizeTodoProgress", () => {
  it("returns null for an empty entry list", () => {
    expect(summarizeTodoProgress([])).toBeNull();
  });

  it("reports the in-progress entry as the current step", () => {
    const summary = summarizeTodoProgress(entries(2, "in_progress", 5));
    expect(summary).toEqual({
      completedCount: 2,
      total: 5,
      currentStepNumber: 3,
      label: "Step 3/5",
    });
  });

  it("clamps the current step at the total once every entry is completed", () => {
    const summary = summarizeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
    ]);
    expect(summary).toEqual({
      completedCount: 2,
      total: 2,
      currentStepNumber: 2,
      label: "Step 2/2",
    });
  });

  it("starts at step 1 when nothing has completed yet", () => {
    const summary = summarizeTodoProgress([
      { content: "a", status: "in_progress" },
      { content: "b", status: "pending" },
    ]);
    expect(summary?.currentStepNumber).toBe(1);
  });
});

describe("hasTodoStepAdvanced", () => {
  it("is false on first appearance (no previous summary)", () => {
    const next = summarizeTodoProgress(entries(1, "in_progress", 1));
    expect(hasTodoStepAdvanced(null, next)).toBe(false);
  });

  it("is false once the tracker disappears", () => {
    const previous = summarizeTodoProgress(entries(1, "in_progress", 1));
    expect(hasTodoStepAdvanced(previous, null)).toBe(false);
  });

  it("is true when the current step number increases", () => {
    const previous = summarizeTodoProgress(entries(1, "in_progress", 1));
    const next = summarizeTodoProgress(entries(2, "in_progress", 2));
    expect(hasTodoStepAdvanced(previous, next)).toBe(true);
  });

  it("is false when nothing has changed", () => {
    const previous = summarizeTodoProgress(entries(2, "in_progress", 2));
    const next = summarizeTodoProgress(entries(2, "in_progress", 2));
    expect(hasTodoStepAdvanced(previous, next)).toBe(false);
  });

  it("is true when the total entry count changes even if the step number does not", () => {
    const previous = summarizeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
    ]);
    const next = summarizeTodoProgress([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" },
    ]);
    expect(hasTodoStepAdvanced(previous, next)).toBe(true);
  });
});

function entries(completedCount: number, activeStatus: PlanEntry["status"], total: number): PlanEntry[] {
  return Array.from({ length: total }, (_, index) => ({
    content: `step-${index}`,
    status: index < completedCount ? "completed" : index === completedCount ? activeStatus : "pending",
  }));
}
