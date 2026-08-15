import { describe, expect, it } from "vitest";
import type {
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import { detectWorkflowAutoAdvance } from "./run-view-model";

// The auto-advance detector's cases, split from `run-view-model.test.ts` to
// keep both files under the max-lines threshold. The fixture builders are
// duplicated on purpose: each file stays self-contained rather than sharing a
// non-test fixtures module out of the domain directory.

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

function node(
  overrides: Partial<WorkflowRunNodeV2> & { id: string },
): WorkflowRunNodeV2 {
  return {
    runId: "run-1",
    definitionNodeId: overrides.id,
    kind: "defined",
    nodeType: "agent",
    replacesNodeRowId: null,
    anchorNodeRowId: null,
    chainIndex: 0,
    title: overrides.id,
    prompt: "",
    status: "pending",
    sessionId: null,
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-14T00:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function projection(
  nodes: WorkflowRunNodeV2[],
  overrides: Partial<WorkflowRunV2> = {},
): WorkflowRunProjectionV2 {
  return { run: run(overrides), nodes, docs: [] };
}

describe("detectWorkflowAutoAdvance", () => {
  const previous = projection(
    [
      node({ id: "a", chainIndex: 0, status: "running" }),
      node({ id: "b", chainIndex: 1 }),
    ],
    { currentNodeRowId: "a" },
  );

  it("fires when an agent node completed and the run moved on by itself", () => {
    const next = projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed" }),
        node({ id: "b", chainIndex: 1, status: "running" }),
      ],
      { currentNodeRowId: "b" },
    );

    expect(detectWorkflowAutoAdvance(previous, next)).toEqual({
      completedNode: next.nodes[0],
      startedNode: next.nodes[1],
    });
  });

  it("returns null on first load, when there is no previous projection", () => {
    const next = projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed" }),
        node({ id: "b", chainIndex: 1, status: "running" }),
      ],
      { currentNodeRowId: "b" },
    );

    expect(detectWorkflowAutoAdvance(undefined, next)).toBeNull();
  });

  it("returns null when the current node did not move", () => {
    expect(detectWorkflowAutoAdvance(previous, previous)).toBeNull();
  });

  it("returns null when the finished node is human_in_loop (a deliberate approve)", () => {
    const approvedPrevious = projection(
      [
        node({ id: "a", chainIndex: 0, status: "awaiting_human", nodeType: "human_in_loop" }),
        node({ id: "b", chainIndex: 1 }),
      ],
      { currentNodeRowId: "a" },
    );
    const next = projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed", nodeType: "human_in_loop" }),
        node({ id: "b", chainIndex: 1, status: "running" }),
      ],
      { currentNodeRowId: "b" },
    );

    expect(detectWorkflowAutoAdvance(approvedPrevious, next)).toBeNull();
  });

  it("returns null when the finished agent node was awaiting a human (an approve gate)", () => {
    const gatedPrevious = projection(
      [
        node({ id: "a", chainIndex: 0, status: "awaiting_human" }),
        node({ id: "b", chainIndex: 1 }),
      ],
      { currentNodeRowId: "a" },
    );
    const next = projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed" }),
        node({ id: "b", chainIndex: 1, status: "running" }),
      ],
      { currentNodeRowId: "b" },
    );

    expect(detectWorkflowAutoAdvance(gatedPrevious, next)).toBeNull();
  });

  it("returns null when the previous node did not actually complete", () => {
    const next = projection(
      [
        node({ id: "a", chainIndex: 0, status: "failed" }),
        node({ id: "b", chainIndex: 1, status: "running" }),
      ],
      { currentNodeRowId: "b" },
    );

    expect(detectWorkflowAutoAdvance(previous, next)).toBeNull();
  });

  it("returns null when the new current node is missing from the projection", () => {
    const next = projection(
      [node({ id: "a", chainIndex: 0, status: "completed" })],
      { currentNodeRowId: "b" },
    );

    expect(detectWorkflowAutoAdvance(previous, next)).toBeNull();
  });

  it("returns null when the finished node is missing from the projection", () => {
    const next = projection(
      [node({ id: "b", chainIndex: 1, status: "running" })],
      { currentNodeRowId: "b" },
    );

    expect(detectWorkflowAutoAdvance(previous, next)).toBeNull();
  });

  it("returns null when either side has no current node at all", () => {
    const parked = projection(
      [node({ id: "a", chainIndex: 0, status: "completed" })],
      { currentNodeRowId: null },
    );

    expect(detectWorkflowAutoAdvance(previous, parked)).toBeNull();
    expect(detectWorkflowAutoAdvance(parked, previous)).toBeNull();
  });
});
