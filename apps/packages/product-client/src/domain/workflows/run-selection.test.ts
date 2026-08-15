import { describe, expect, it } from "vitest";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { selectNewestWorkflowRun } from "./run-selection";

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
