import { describe, expect, it } from "vitest";
import { deriveDelegatedWorkSummary } from "./delegated-work";

describe("deriveDelegatedWorkSummary", () => {
  it("uses the highest-priority mixed delegated-work state", () => {
    expect(deriveDelegatedWorkSummary([
      { priority: "running", label: "running", count: 3 },
      { priority: "wake_scheduled", label: "wake scheduled", count: 1 },
      { priority: "needs_action", label: "needs action", count: 2 },
    ])).toEqual({ label: "2 needs action", active: true });
  });

  it("marks finished summaries inactive", () => {
    expect(deriveDelegatedWorkSummary([
      { priority: "finished", label: "finished", count: 1 },
    ])).toEqual({ label: "finished", active: false });
  });

  it("returns a stable inactive summary for empty delegated work", () => {
    expect(deriveDelegatedWorkSummary([])).toEqual({
      label: "No active work",
      active: false,
    });
  });
});
