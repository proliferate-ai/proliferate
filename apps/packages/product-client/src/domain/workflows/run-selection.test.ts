import { describe, expect, it } from "vitest";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { selectNewestWorkflowRun, selectVisibleWorkflowRuns } from "./run-selection";

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
