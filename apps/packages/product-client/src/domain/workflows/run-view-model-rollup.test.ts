// Rung 7 (ruling F4): the per-leg fan-in rollup derivation, split from
// run-view-model.test.ts to keep that suite under its size cap (the same reason
// run-view-model-advance.test.ts stands apart).

import { describe, expect, it } from "vitest";
import type {
  WorkflowLegStatusV2,
  WorkflowRunNodeSessionV2,
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import {
  buildWorkflowGraph,
  workflowNodeLegRollup,
  workflowNodeLegTone,
} from "./run-view-model";

const LEG_STATUSES: WorkflowLegStatusV2[] = [
  "running",
  "done",
  "cancelled",
  "forced_unload",
  "failed",
];

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

function node(overrides: Partial<WorkflowRunNodeV2> & { id: string }): WorkflowRunNodeV2 {
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
    status: "running",
    sessionId: null,
    promptId: null,
    failureCode: null,
    createdAt: "2026-08-14T00:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function leg(
  overrides: Partial<WorkflowRunNodeSessionV2> & { legIndex: number },
): WorkflowRunNodeSessionV2 {
  return {
    sessionId: `session-${overrides.legIndex}`,
    status: "running",
    failureCode: null,
    completedAt: null,
    ...overrides,
  };
}

function projection(nodes: WorkflowRunNodeV2[]): WorkflowRunProjectionV2 {
  return { run: run(), nodes, docs: [] };
}

describe("workflowNodeLegTone", () => {
  it("maps every leg status onto exactly one tone", () => {
    expect(LEG_STATUSES.map((status) => workflowNodeLegTone(status))).toEqual([
      "current",
      "success",
      "muted",
      "warning",
      "danger",
    ]);
  });

  it("falls back to muted for a leg status outside the union instead of throwing", () => {
    const unknown = "verifying" as WorkflowLegStatusV2;
    expect(() => workflowNodeLegTone(unknown)).not.toThrow();
    expect(workflowNodeLegTone(unknown)).toBe("muted");
  });
});

describe("workflowNodeLegRollup", () => {
  it("rolls up a parallel node's legs (sorted, terminal-counted) with per-leg tones", () => {
    // Fed out of order to prove the sort; done + failed are terminal, running is not.
    const rollup = workflowNodeLegRollup(node({
      id: "review",
      sessions: [
        leg({ legIndex: 2, status: "running" }),
        leg({ legIndex: 0, status: "done" }),
        leg({ legIndex: 1, status: "failed", failureCode: "turn_error" }),
      ],
    }));

    expect(rollup).not.toBeNull();
    expect(rollup!.total).toBe(3);
    expect(rollup!.finished).toBe(2);
    expect(rollup!.legs.map((entry) => [entry.legIndex, entry.status, entry.tone])).toEqual([
      [0, "done", "success"],
      [1, "failed", "danger"],
      [2, "running", "current"],
    ]);
    expect(rollup!.legs[1]!.failureCode).toBe("turn_error");
  });

  it("returns null for a one-leg node so it falls back to the scalar sessionId", () => {
    expect(workflowNodeLegRollup(node({
      id: "solo",
      sessions: [leg({ legIndex: 0, status: "running" })],
    }))).toBeNull();
  });

  it("returns null when the runtime predates the rollup and omits sessions", () => {
    const withoutSessions = node({ id: "old" });
    expect(withoutSessions.sessions).toBeUndefined();
    expect(workflowNodeLegRollup(withoutSessions)).toBeNull();
  });

  it("carries the rollup onto the graph VM for a parallel node and null otherwise", () => {
    const slots = buildWorkflowGraph(projection([
      node({
        id: "parallel",
        chainIndex: 0,
        sessions: [
          leg({ legIndex: 0, status: "done" }),
          leg({ legIndex: 1, status: "running" }),
        ],
      }),
      node({ id: "solo", chainIndex: 1, sessions: [leg({ legIndex: 0, status: "running" })] }),
    ]));

    expect(slots[0]!.attempts[0]!.legRollup).toMatchObject({ total: 2, finished: 1 });
    expect(slots[1]!.attempts[0]!.legRollup).toBeNull();
  });
});
