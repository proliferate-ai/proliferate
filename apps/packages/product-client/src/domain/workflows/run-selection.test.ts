import { describe, expect, it } from "vitest";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import {
  MAX_VISIBLE_RUN_RAILS,
  selectNewestWorkflowRun,
  selectVisibleWorkflowRuns,
  selectWorkflowRunRailWindow,
} from "./run-selection";

function run(overrides: Partial<WorkflowRunV2> = {}): WorkflowRunV2 {
  return {
    id: "run-1",
    invocationId: "invocation-1",
    definitionJson: "{}",
    argumentsJson: "{}",
    workspaceId: "workspace-1",
    status: "running",
    currentNodeRowId: null,
    failureCode: null,
    interruptionCode: null,
    createdAt: "2026-08-14T00:00:00Z",
    updatedAt: "2026-08-14T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

describe("selectNewestWorkflowRun", () => {
  it("returns null when the workspace has no runs", () => {
    expect(selectNewestWorkflowRun([])).toBeNull();
    expect(selectNewestWorkflowRun(undefined)).toBeNull();
  });

  it("returns the newest run by createdAt regardless of list order", () => {
    const newest = selectNewestWorkflowRun([
      run({ id: "old", createdAt: "2026-08-14T00:00:00Z" }),
      run({ id: "new", createdAt: "2026-08-14T09:00:00Z" }),
      run({ id: "middle", createdAt: "2026-08-14T04:00:00Z" }),
    ]);

    expect(newest?.id).toBe("new");
  });

  it("breaks a createdAt tie by row id so the winner never flickers", () => {
    const sameInstant = "2026-08-14T00:00:00Z";
    expect(selectNewestWorkflowRun([
      run({ id: "a", createdAt: sameInstant }),
      run({ id: "b", createdAt: sameInstant }),
    ])?.id).toBe("b");
  });
});

describe("selectVisibleWorkflowRuns", () => {
  it("returns nothing for an empty roster", () => {
    expect(selectVisibleWorkflowRuns([])).toEqual([]);
    expect(selectVisibleWorkflowRuns(undefined)).toEqual([]);
  });

  it("collapses a single terminal run to itself, matching selectNewestWorkflowRun", () => {
    const terminal = run({ id: "done", status: "completed" });

    const visible = selectVisibleWorkflowRuns([terminal]);

    expect(visible).toEqual([terminal]);
    expect(visible).toEqual([selectNewestWorkflowRun([terminal])]);
  });

  it("returns the single live run untouched", () => {
    const live = run({ id: "live", status: "running" });

    expect(selectVisibleWorkflowRuns([live])).toEqual([live]);
  });

  it("shows only the live run when older terminal runs share the workspace", () => {
    const live = run({ id: "live", status: "awaiting_human", createdAt: "2026-08-14T09:00:00Z" });
    const olderTerminal = run({
      id: "old-done",
      status: "completed",
      createdAt: "2026-08-14T00:00:00Z",
    });

    const visible = selectVisibleWorkflowRuns([olderTerminal, live]);

    expect(visible).toEqual([live]);
  });

  it("surfaces two live runs newest first — the whole point of the rail", () => {
    const older = run({ id: "older", status: "running", createdAt: "2026-08-14T00:00:00Z" });
    const newer = run({ id: "newer", status: "interrupted", createdAt: "2026-08-14T09:00:00Z" });

    const visible = selectVisibleWorkflowRuns([older, newer]);

    // Negative control: selection must not collapse two live runs to one —
    // asserting the array's identity rather than "contains both" catches a
    // regression back to picking a single newest run.
    expect(visible.map((candidate) => candidate.id)).toEqual(["newer", "older"]);
  });

  it("picks the newest terminal run when every run in the roster has finished", () => {
    const older = run({ id: "older", status: "failed", createdAt: "2026-08-14T00:00:00Z" });
    const newer = run({ id: "newer", status: "cancelled", createdAt: "2026-08-14T09:00:00Z" });

    expect(selectVisibleWorkflowRuns([older, newer])).toEqual([newer]);
  });
});

describe("selectWorkflowRunRailWindow", () => {
  const live = (id: string, minute: number, status = "running") =>
    run({ id, status: status as WorkflowRunV2["status"], createdAt: `2026-08-14T00:${String(minute).padStart(2, "0")}:00Z` });

  it("renders every run without an overflow when the visible set fits the cap", () => {
    const runs = [live("a", 3), live("b", 2), live("c", 1)];
    const window = selectWorkflowRunRailWindow(runs, 0);
    expect(window.railWindow.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(window.hiddenCount).toBe(0);
    expect(window.pageCount).toBe(1);
  });

  it("caps the window at four and counts the rest as hidden (ruling F-A2)", () => {
    const runs = [5, 4, 3, 2, 1].map((m) => live(`r${m}`, m));
    const window = selectWorkflowRunRailWindow(runs, 0);
    expect(window.railWindow).toHaveLength(MAX_VISIBLE_RUN_RAILS);
    expect(window.hiddenCount).toBe(1);
    expect(window.pageCount).toBe(2);
  });

  it("promotes runs waiting on a human onto page 0 ahead of newer running work", () => {
    // The gated run is the OLDEST — without promotion it would be the hidden one.
    const gated = live("gated", 1, "awaiting_human");
    const runs = [live("r5", 5), live("r4", 4), live("r3", 3), live("r2", 2), gated];
    const window = selectWorkflowRunRailWindow(runs, 0);
    expect(window.railWindow[0].id).toBe("gated");
    expect(window.railWindow.map((r) => r.id)).not.toContain("r2");
  });

  it("pages the window and clamps a page the shrinking set no longer has", () => {
    const runs = [5, 4, 3, 2, 1].map((m) => live(`r${m}`, m));
    const pageOne = selectWorkflowRunRailWindow(runs, 1);
    expect(pageOne.railWindow.map((r) => r.id)).toEqual(["r1"]);
    expect(pageOne.hiddenCount).toBe(4);
    const clamped = selectWorkflowRunRailWindow(runs.slice(0, 2), 1);
    expect(clamped.page).toBe(0);
    expect(clamped.railWindow).toHaveLength(2);
  });
});
