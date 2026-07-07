import { describe, expect, it } from "vitest";
import {
  deriveGoalBarState,
  goalFailureDetail,
  goalMetMarkerLabel,
  goalResultStats,
  goalResultWhyLabel,
  goalStatusLabel,
  goalStatusTone,
  humanizeGoalDurationSeconds,
  parseGoalWire,
  truncateGoalObjective,
  type GoalWire,
} from "./goal";

function goal(overrides: Partial<GoalWire> = {}): GoalWire {
  return {
    objective: "DONE.txt exists containing done",
    status: "active",
    nativeStatus: "active",
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    metReason: null,
    iterations: null,
    native: true,
    updatedAtMs: 1_750_000_000_000,
    ...overrides,
  };
}

describe("parseGoalWire", () => {
  it("round-trips a full wire payload", () => {
    const wire = goal({
      tokenBudget: 50_000,
      tokensUsed: 1_234,
      timeUsedSeconds: 42,
      metReason: "file present with expected contents",
      iterations: 3,
    });
    expect(parseGoalWire(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
  });

  it("treats missing nullable fields as null", () => {
    const parsed = parseGoalWire({
      objective: "x",
      status: "active",
      nativeStatus: "active",
      native: true,
      updatedAtMs: 1,
    });
    expect(parsed).toEqual(goal({
      objective: "x",
      updatedAtMs: 1,
    }));
  });

  it("rejects unknown statuses instead of guessing", () => {
    expect(parseGoalWire({ ...goal(), status: "complete" })).toBeNull();
  });

  it("rejects non-object and malformed payloads", () => {
    expect(parseGoalWire(null)).toBeNull();
    expect(parseGoalWire("goal")).toBeNull();
    expect(parseGoalWire({ ...goal(), objective: 7 })).toBeNull();
    expect(parseGoalWire({ ...goal(), tokensUsed: "many" })).toBeNull();
    expect(parseGoalWire({ ...goal(), updatedAtMs: null })).toBeNull();
  });
});

describe("deriveGoalBarState", () => {
  it("hides the bar when no goal exists or the goal is cleared", () => {
    expect(deriveGoalBarState(null)).toEqual({ kind: "hidden" });
    expect(deriveGoalBarState(goal({ status: "cleared" }))).toEqual({ kind: "hidden" });
  });

  it("maps active and paused to the live bar", () => {
    expect(deriveGoalBarState(goal())).toMatchObject({ kind: "live", phase: "pursuing" });
    expect(deriveGoalBarState(goal({ status: "paused" })))
      .toMatchObject({ kind: "live", phase: "paused" });
  });

  it("maps met to a sticky result carrying the evaluator reason", () => {
    const state = deriveGoalBarState(goal({
      status: "met",
      metReason: "DONE.txt exists and contains done",
    }));
    expect(state).toMatchObject({
      kind: "result",
      outcome: "met",
      headline: "Goal met",
      detail: "DONE.txt exists and contains done",
    });
  });

  it("keeps a null met detail when the harness gives no reason", () => {
    expect(deriveGoalBarState(goal({ status: "met" })))
      .toMatchObject({ kind: "result", outcome: "met", detail: null });
  });

  it("maps blocked to the needs-you result", () => {
    expect(deriveGoalBarState(goal({ status: "blocked", nativeStatus: "blocked" })))
      .toMatchObject({
        kind: "result",
        outcome: "blocked",
        headline: "Blocked",
        detail: "needs you",
      });
  });

  it("surfaces the native budget detail on failed goals", () => {
    expect(deriveGoalBarState(goal({ status: "failed", nativeStatus: "budgetLimited" })))
      .toMatchObject({
        kind: "result",
        outcome: "failed",
        headline: "Goal stopped",
        detail: "budget exhausted",
      });
    expect(deriveGoalBarState(goal({ status: "failed", nativeStatus: "usageLimited" })))
      .toMatchObject({ detail: "usage limit reached" });
  });
});

describe("goalFailureDetail", () => {
  it("falls back to metReason for unknown native statuses", () => {
    expect(goalFailureDetail(goal({
      status: "failed",
      nativeStatus: "impossible",
      metReason: "condition can never hold",
    }))).toBe("condition can never hold");
    expect(goalFailureDetail(goal({ status: "failed", nativeStatus: "impossible" }))).toBeNull();
  });
});

describe("display reducers", () => {
  it("labels every status", () => {
    expect(goalStatusLabel("active")).toBe("Pursuing goal");
    expect(goalStatusLabel("paused")).toBe("Goal paused");
    expect(goalStatusLabel("blocked")).toBe("Blocked");
    expect(goalStatusLabel("met")).toBe("Goal met");
    expect(goalStatusLabel("failed")).toBe("Goal stopped");
    expect(goalStatusLabel("cleared")).toBe("Goal cleared");
  });

  it("tones every status", () => {
    expect(goalStatusTone("active")).toBe("default");
    expect(goalStatusTone("paused")).toBe("muted");
    expect(goalStatusTone("met")).toBe("positive");
    expect(goalStatusTone("blocked")).toBe("attention");
    expect(goalStatusTone("failed")).toBe("danger");
    expect(goalStatusTone("cleared")).toBe("muted");
  });

  it("collapses whitespace and caps objective previews", () => {
    expect(truncateGoalObjective("  fix\n the   flaky test  ")).toBe("fix the flaky test");
    const long = "a".repeat(200);
    const preview = truncateGoalObjective(long);
    expect(preview.length).toBe(120);
    expect(preview.endsWith("…")).toBe(true);
    expect(truncateGoalObjective("exact", 5)).toBe("exact");
    expect(truncateGoalObjective("sixsix", 5)).toBe("sixs…");
  });

  it("labels the expand popover's why-section per outcome", () => {
    expect(goalResultWhyLabel("met")).toBe("Why it's met");
    expect(goalResultWhyLabel("blocked")).toBe("Why it's blocked");
    expect(goalResultWhyLabel("failed")).toBe("Why it stopped");
  });
});

describe("humanizeGoalDurationSeconds", () => {
  it("formats sub-minute durations as bare seconds", () => {
    expect(humanizeGoalDurationSeconds(0)).toBe("0s");
    expect(humanizeGoalDurationSeconds(45)).toBe("45s");
  });

  it("formats minute-scale durations, dropping a zero seconds remainder", () => {
    expect(humanizeGoalDurationSeconds(312)).toBe("5m 12s");
    expect(humanizeGoalDurationSeconds(300)).toBe("5m");
  });

  it("formats hour-scale durations, dropping a zero minutes remainder", () => {
    expect(humanizeGoalDurationSeconds(4_320)).toBe("1h 12m");
    expect(humanizeGoalDurationSeconds(7_200)).toBe("2h");
  });

  it("clamps negative input to zero", () => {
    expect(humanizeGoalDurationSeconds(-5)).toBe("0s");
  });
});

describe("goalResultStats", () => {
  it("returns an empty row when the goal carries no usage data", () => {
    expect(goalResultStats(goal())).toEqual([]);
  });

  it("includes only the fields the harness reported, each humanized", () => {
    expect(goalResultStats(goal({ iterations: 4, tokensUsed: 41_872, timeUsedSeconds: 312 }))).toEqual([
      { key: "iterations", text: "4 iterations" },
      { key: "tokensUsed", text: "41,872 tokens" },
      { key: "timeUsedSeconds", text: "5m 12s" },
    ]);
    expect(goalResultStats(goal({ iterations: 1 }))).toEqual([
      { key: "iterations", text: "1 iteration" },
    ]);
  });
});

describe("goalMetMarkerLabel", () => {
  it("appends the humanized elapsed time when timeUsedSeconds is reported", () => {
    expect(goalMetMarkerLabel(goal({ timeUsedSeconds: 40 }))).toBe("Goal achieved in 40s");
    expect(goalMetMarkerLabel(goal({ timeUsedSeconds: 312 }))).toBe("Goal achieved in 5m 12s");
  });

  it("falls back to a bare 'Goal achieved' when no time is available", () => {
    expect(goalMetMarkerLabel(goal({ timeUsedSeconds: null }))).toBe("Goal achieved");
    expect(goalMetMarkerLabel(goal({ timeUsedSeconds: 0 }))).toBe("Goal achieved");
  });
});
