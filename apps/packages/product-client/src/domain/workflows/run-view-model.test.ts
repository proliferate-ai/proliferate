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
  workflowNodeControls,
  workflowNodeIsSideNode,
  workflowNodeStatusTone,
  workflowRunIsActive,
  workflowRunTakesSideNode,
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

  // A status the union does not know about is not hypothetical: a runtime ahead
  // of this build (or a stale prebuilt binary behind it) serializes exactly
  // this. An undefined tone reaches StatusDot's own tone map and throws inside
  // render, and the client's single root error boundary escalates that to
  // whole-app crash recovery — so the floor is a muted dot, never a throw.
  const UNKNOWN_STATUS = "verifying" as WorkflowRunNodeStatusV2;

  it("falls back to muted for a status outside the union instead of throwing", () => {
    expect(() => workflowNodeStatusTone(UNKNOWN_STATUS)).not.toThrow();
    expect(workflowNodeStatusTone(UNKNOWN_STATUS)).toBe("muted");
  });

  it("carries the muted fallback through the graph a node card renders from", () => {
    const slots = buildWorkflowGraph(projection([
      node({ id: "a", chainIndex: 0, status: UNKNOWN_STATUS }),
    ]));

    expect(slots[0]!.attempts[0]!.tone).toBe("muted");
    expect(slots[0]!.attempts[0]!.controls).toEqual({
      approve: false,
      failRedo: false,
      flipToAgent: false,
      flipToHuman: false,
      addAdhoc: true,
    });
  });
});

describe("workflowRunIsActive", () => {
  it("is true for every non-terminal run status and false for both terminal ones", () => {
    expect(
      RUN_STATUSES.map((status) => workflowRunIsActive(run({ status }))),
    ).toEqual([true, true, true, false, false]);
  });
});

describe("workflowRunTakesSideNode", () => {
  // Narrower than "active": a parked (interrupted) run is not growing, so the
  // side-node affordance is withheld even though the runtime would accept it.
  it("excludes interrupted, which workflowRunIsActive includes", () => {
    expect(
      RUN_STATUSES.map((status) => workflowRunTakesSideNode(run({ status }))),
    ).toEqual([true, true, false, false, false]);
    expect(workflowRunIsActive(run({ status: "interrupted" }))).toBe(true);
  });
});

describe("workflowNodeIsSideNode", () => {
  it("reads adhoc rows as side nodes and defined/replacement chain rows as chain", () => {
    expect(workflowNodeIsSideNode(node({ id: "s", kind: "adhoc", anchorNodeRowId: "a" }))).toBe(true);
    expect(workflowNodeIsSideNode(node({ id: "d" }))).toBe(false);
    expect(
      workflowNodeIsSideNode(
        node({ id: "r", kind: "replacement", replacesNodeRowId: "d" }),
      ),
    ).toBe(false);
  });

  // Contractually impossible today (the runtime's Redo mints a replacement
  // with no anchor, and redoing an ad hoc row mints another ad hoc row), so
  // this pins the safe direction rather than a live shape: an anchored
  // replacement reads
  // as off-chain, which withholds chain controls instead of offering an advance
  // from a copied chainIndex.
  it("reads an anchored replacement as a side node", () => {
    expect(
      workflowNodeIsSideNode(
        node({ id: "r", kind: "replacement", replacesNodeRowId: "s", anchorNodeRowId: "a" }),
      ),
    ).toBe(true);
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

  // AddAdhocNode: run-scoped, offered on every chain card of a run that is
  // actually moving — an interrupted run is parked, so it is withheld there.
  it.each(RUN_STATUSES)("gates addAdhoc on the run taking side nodes (%s)", (status) => {
    expect(
      workflowNodeControls(run({ status }), node({ id: "n", status: "running" })).addAdhoc,
    ).toBe(status === "running" || status === "awaiting_human");
  });

  it("withholds addAdhoc on an interrupted (parked) run", () => {
    expect(
      workflowNodeControls(
        run({ status: "interrupted" }),
        node({ id: "n", status: "needs_attention" }),
      ),
    ).toEqual({
      approve: false,
      failRedo: true,
      flipToAgent: false,
      flipToHuman: false,
      addAdhoc: false,
    });
  });

  // ADR: adhoc rows "never advance or block the run" — gate, flip, and anchor
  // semantics are chain-only (approve requires being the current node, which
  // an adhoc row never is; flip has "no gate semantics"; adhoc rows are
  // rejected as anchors). A side node copies its anchor's chainIndex, so
  // keying on status/nodeType alone would render chain controls on it. Redo
  // alone survives: fix-wave Ruling K makes FailAndRedo legal on an ad hoc row
  // in needs_attention/failed, minting an ad hoc replacement anchored the
  // same.
  it("offers no controls on a running adhoc side node", () => {
    expect(
      workflowNodeControls(
        run(),
        node({
          id: "side",
          kind: "adhoc",
          definitionNodeId: null,
          anchorNodeRowId: "n",
          status: "running",
          nodeType: "agent",
        }),
      ),
    ).toEqual({
      approve: false,
      failRedo: false,
      flipToAgent: false,
      flipToHuman: false,
      addAdhoc: false,
    });
  });

  it.each(NODE_STATUSES)("offers redo and only redo on an adhoc side node in %s", (status) => {
    expect(
      workflowNodeControls(
        run(),
        node({ id: "side", kind: "adhoc", definitionNodeId: null, anchorNodeRowId: "n", status }),
      ),
    ).toEqual({
      approve: false,
      failRedo: status === "failed" || status === "needs_attention",
      flipToAgent: false,
      flipToHuman: false,
      addAdhoc: false,
    });
  });

  // Positive control for the same gate: the defined chain node the side node
  // hangs off is untouched by it.
  it("leaves a running defined agent node's controls exactly as they were", () => {
    expect(
      workflowNodeControls(run(), node({ id: "n", status: "running", nodeType: "agent" })),
    ).toEqual({
      approve: false,
      failRedo: false,
      flipToAgent: false,
      flipToHuman: true,
      addAdhoc: true,
    });
  });

  it("treats a replacement of a chain node as the chain node it replaces", () => {
    expect(
      workflowNodeControls(
        run(),
        node({
          id: "n2",
          kind: "replacement",
          replacesNodeRowId: "n",
          status: "awaiting_human",
          nodeType: "human_in_loop",
        }),
      ),
    ).toEqual({
      approve: true,
      failRedo: true,
      flipToAgent: true,
      flipToHuman: false,
      addAdhoc: true,
    });
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

  // Placement and controls read the same predicate, so a row that renders with
  // a side node's redo-only control set is never drawn as a chain attempt.
  it("places an anchored replacement off the chain, beside the adhoc rows", () => {
    const slots = buildWorkflowGraph(projection([
      node({ id: "a", chainIndex: 0 }),
      node({
        id: "side-2",
        kind: "replacement",
        replacesNodeRowId: "side-1",
        anchorNodeRowId: "a",
        chainIndex: 0,
        createdAt: "2026-08-14T00:00:09Z",
      }),
    ]));

    expect(slots[0]!.attempts.map((vm) => vm.node.id)).toEqual(["a"]);
    expect(slots[0]!.adhoc.map((vm) => vm.node.id)).toEqual(["side-2"]);
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
