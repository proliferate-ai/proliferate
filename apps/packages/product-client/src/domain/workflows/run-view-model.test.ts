import { describe, expect, it } from "vitest";
import type {
  WorkflowRunNodeStatusV2,
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunStatusV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import {
  buildWorkflowGraph,
  detectWorkflowAutoAdvance,
  workflowNodeControls,
  workflowNodeStatusTone,
  workflowRunIsActive,
} from "./run-view-model";

const NODE_STATUSES: WorkflowRunNodeStatusV2[] = [
  "pending",
  "running",
  "needs_attention",
  "awaiting_human",
  "completed",
  "failed",
];

const RUN_STATUSES: WorkflowRunStatusV2[] = [
  "running",
  "awaiting_human",
  "interrupted",
  "completed",
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

describe("workflowNodeStatusTone", () => {
  it("maps every node status onto exactly one tone", () => {
    expect(NODE_STATUSES.map((status) => workflowNodeStatusTone(status))).toEqual([
      "muted",
      "current",
      "warning",
      "info",
      "success",
      "danger",
    ]);
  });
});

describe("workflowRunIsActive", () => {
  it("is true for every non-terminal run status and false for both terminal ones", () => {
    expect(
      RUN_STATUSES.map((status) => workflowRunIsActive(run({ status }))),
    ).toEqual([true, true, true, false, false]);
  });
});

describe("workflowNodeControls — the transition table, row by row", () => {
  // ApproveGate: legal only on awaiting_human.
  it.each(NODE_STATUSES)("approve is %s-gated to awaiting_human", (status) => {
    expect(workflowNodeControls(run(), node({ id: "n", status })).approve).toBe(
      status === "awaiting_human",
    );
  });

  // FailAndRedo: legal from failed, needs_attention, and awaiting_human.
  it.each(NODE_STATUSES)("failRedo is offered on %s per the table", (status) => {
    expect(workflowNodeControls(run(), node({ id: "n", status })).failRedo).toBe(
      status === "failed" || status === "needs_attention" || status === "awaiting_human",
    );
  });

  // FlipType → agent: legal only on an awaiting_human human_in_loop node.
  it("offers flipToAgent only on an awaiting_human human_in_loop node", () => {
    expect(
      workflowNodeControls(
        run(),
        node({ id: "n", status: "awaiting_human", nodeType: "human_in_loop" }),
      ).flipToAgent,
    ).toBe(true);
  });

  it("withholds flipToAgent from an awaiting_human agent node", () => {
    expect(
      workflowNodeControls(
        run(),
        node({ id: "n", status: "awaiting_human", nodeType: "agent" }),
      ).flipToAgent,
    ).toBe(false);
  });

  it("withholds flipToAgent from a human_in_loop node that is not awaiting_human", () => {
    expect(
      workflowNodeControls(
        run(),
        node({ id: "n", status: "running", nodeType: "human_in_loop" }),
      ).flipToAgent,
    ).toBe(false);
  });

  // FlipType → human_in_loop: legal only on a running agent node.
  it("offers flipToHuman only on a running agent node", () => {
    expect(
      workflowNodeControls(
        run(),
        node({ id: "n", status: "running", nodeType: "agent" }),
      ).flipToHuman,
    ).toBe(true);
  });

  it("withholds flipToHuman from a running human_in_loop node", () => {
    expect(
      workflowNodeControls(
        run(),
        node({ id: "n", status: "running", nodeType: "human_in_loop" }),
      ).flipToHuman,
    ).toBe(false);
  });

  it("withholds flipToHuman from an agent node that is not running", () => {
    expect(
      workflowNodeControls(
        run(),
        node({ id: "n", status: "awaiting_human", nodeType: "agent" }),
      ).flipToHuman,
    ).toBe(false);
  });

  // AddAdhocNode: run-scoped, offered on every card of an active run.
  it.each(RUN_STATUSES)("gates addAdhoc on the run being active (%s)", (status) => {
    expect(
      workflowNodeControls(run({ status }), node({ id: "n", status: "running" })).addAdhoc,
    ).toBe(status === "running" || status === "awaiting_human" || status === "interrupted");
  });

  // Negative control: a finished node offers no node-scoped control at all,
  // while the run-scoped one is untouched by node status.
  it("offers nothing but addAdhoc on a completed node", () => {
    expect(workflowNodeControls(run(), node({ id: "n", status: "completed" }))).toEqual({
      approve: false,
      failRedo: false,
      flipToAgent: false,
      flipToHuman: false,
      addAdhoc: true,
    });
  });

  // Negative control: a terminal run cannot take an ad hoc node even from a
  // node whose own status would otherwise look actionable.
  it("withholds addAdhoc on a terminal run", () => {
    expect(
      workflowNodeControls(
        run({ status: "completed" }),
        node({ id: "n", status: "awaiting_human" }),
      ),
    ).toEqual({
      approve: true,
      failRedo: true,
      flipToAgent: false,
      flipToHuman: false,
      addAdhoc: false,
    });
  });
});

describe("buildWorkflowGraph", () => {
  it("puts a replacement in its predecessor's slot through the inherited chainIndex", () => {
    const slots = buildWorkflowGraph(projection([
      node({ id: "a", chainIndex: 0, status: "failed" }),
      node({
        id: "a2",
        chainIndex: 0,
        kind: "replacement",
        replacesNodeRowId: "a",
        createdAt: "2026-08-14T00:00:01Z",
      }),
      node({ id: "b", chainIndex: 1 }),
    ]));

    expect(slots.map((slot) => slot.chainIndex)).toEqual([0, 1]);
    expect(slots[0]!.attempts.map((vm) => vm.node.id)).toEqual(["a", "a2"]);
    expect(slots[1]!.attempts.map((vm) => vm.node.id)).toEqual(["b"]);
  });

  it("attaches an adhoc node to its anchor's slot, apart from the attempts", () => {
    const slots = buildWorkflowGraph(projection([
      node({ id: "a", chainIndex: 0 }),
      node({ id: "b", chainIndex: 1 }),
      node({
        id: "side",
        kind: "adhoc",
        definitionNodeId: null,
        anchorNodeRowId: "b",
        // The anchor's position, which is how an adhoc row reaches its slot.
        chainIndex: 1,
        createdAt: "2026-08-14T00:00:05Z",
      }),
    ]));

    expect(slots[1]!.attempts.map((vm) => vm.node.id)).toEqual(["b"]);
    expect(slots[1]!.adhoc.map((vm) => vm.node.id)).toEqual(["side"]);
    expect(slots[0]!.adhoc).toEqual([]);
  });

  it("orders attempts inside a slot by createdAt, not by projection order", () => {
    const slots = buildWorkflowGraph(projection([
      node({ id: "third", chainIndex: 0, createdAt: "2026-08-14T00:00:03Z" }),
      node({ id: "first", chainIndex: 0, createdAt: "2026-08-14T00:00:01Z" }),
      node({ id: "second", chainIndex: 0, createdAt: "2026-08-14T00:00:02Z" }),
    ]));

    expect(slots[0]!.attempts.map((vm) => vm.node.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("breaks a createdAt tie by row id so the order is stable across polls", () => {
    const sameInstant = "2026-08-14T00:00:01Z";
    const slots = buildWorkflowGraph(projection([
      node({ id: "b", chainIndex: 0, createdAt: sameInstant }),
      node({ id: "a", chainIndex: 0, createdAt: sameInstant }),
    ]));

    expect(slots[0]!.attempts.map((vm) => vm.node.id)).toEqual(["a", "b"]);
  });

  it("sorts a null chainIndex last instead of dropping the row", () => {
    const slots = buildWorkflowGraph(projection([
      node({ id: "orphan", chainIndex: null }),
      node({ id: "a", chainIndex: 0 }),
      node({ id: "b", chainIndex: 1 }),
    ]));

    expect(slots.map((slot) => slot.attempts.map((vm) => vm.node.id))).toEqual([
      ["a"],
      ["b"],
      ["orphan"],
    ]);
  });

  it("marks the run's current node and derives each node's tone and controls", () => {
    const slots = buildWorkflowGraph(projection(
      [
        node({ id: "a", chainIndex: 0, status: "completed" }),
        node({ id: "b", chainIndex: 1, status: "awaiting_human", nodeType: "human_in_loop" }),
      ],
      { currentNodeRowId: "b" },
    ));

    expect(slots[0]!.attempts[0]!).toMatchObject({
      isCurrent: false,
      tone: "success",
      controls: { approve: false, addAdhoc: true },
    });
    expect(slots[1]!.attempts[0]!).toMatchObject({
      isCurrent: true,
      tone: "info",
      controls: { approve: true, flipToAgent: true },
    });
  });
});

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
