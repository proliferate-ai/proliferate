import { describe, expect, it } from "vitest";
import type { WorkflowRunNodeV2 } from "@anyharness/sdk";

import type { WorkflowGraphNodeVM, WorkflowGraphSlotVM } from "./run-view-model";
import {
  layoutWorkflowBuilderGraph,
  layoutWorkflowRunGraph,
  WORKFLOW_GRAPH_NODE_HEIGHT,
  WORKFLOW_GRAPH_NODE_WIDTH,
} from "./graph-layout";

function vm(id: string, anchorNodeRowId: string | null = null): WorkflowGraphNodeVM {
  return {
    node: { id, anchorNodeRowId } as WorkflowRunNodeV2,
    isCurrent: false,
    tone: "muted",
    controls: {
      approve: false,
      failRedo: false,
      flipToAgent: false,
      flipToHuman: false,
      addAdhoc: false,
    },
  };
}

function slot(
  chainIndex: number,
  attempts: WorkflowGraphNodeVM[],
  adhoc: WorkflowGraphNodeVM[] = [],
): WorkflowGraphSlotVM {
  return { chainIndex, attempts, adhoc };
}

describe("layoutWorkflowRunGraph", () => {
  it("stacks chain ranks vertically and joins consecutive ranks with one chain edge", () => {
    const layout = layoutWorkflowRunGraph([
      slot(0, [vm("a")]),
      slot(1, [vm("b")]),
    ]);

    const [a, b] = layout.nodes;
    expect(a.x).toBe(0);
    expect(b.x).toBe(0);
    expect(b.y).toBeGreaterThan(a.y + WORKFLOW_GRAPH_NODE_HEIGHT);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ fromKey: "a", toKey: "b", kind: "chain" });
  });

  it("widens a rank for retries and draws the chain edge from the latest attempt", () => {
    const layout = layoutWorkflowRunGraph([
      slot(0, [vm("first"), vm("second")]),
      slot(1, [vm("next")]),
    ]);

    const second = layout.nodes.find((node) => node.key === "second");
    expect(second?.x).toBeGreaterThanOrEqual(WORKFLOW_GRAPH_NODE_WIDTH);
    // No edge between attempts: a retry is the same chain position.
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ fromKey: "second", toKey: "next", kind: "chain" });
  });

  it("hangs a side node off its anchor with a branch edge", () => {
    const layout = layoutWorkflowRunGraph([
      slot(0, [vm("anchor")], [vm("side", "anchor")]),
    ]);

    const side = layout.nodes.find((node) => node.key === "side");
    expect(side?.branch).toBe(true);
    expect(side?.x).toBeGreaterThan(0);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ fromKey: "anchor", toKey: "side", kind: "branch" });
  });

  it("falls back to the rank's latest attempt for an orphaned side node", () => {
    const layout = layoutWorkflowRunGraph([
      slot(0, [vm("anchor")], [vm("orphan", "gone")]),
    ]);

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ fromKey: "anchor", toKey: "orphan", kind: "branch" });
  });

  it("reports content extents that cover every placed card", () => {
    const layout = layoutWorkflowRunGraph([
      slot(0, [vm("a")], [vm("side", "a")]),
      slot(1, [vm("b")]),
    ]);

    for (const node of layout.nodes) {
      expect(node.x + WORKFLOW_GRAPH_NODE_WIDTH).toBeLessThanOrEqual(layout.width);
      expect(node.y + WORKFLOW_GRAPH_NODE_HEIGHT).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe("layoutWorkflowBuilderGraph", () => {
  it("keeps deterministic display order while drawing only authored edges", () => {
    const layout = layoutWorkflowBuilderGraph(
      ["one", "two", "three"],
      [{ from: "one", to: "three" }],
    );

    expect(layout.nodes.map((node) => node.x)).toEqual([0, 0, 0]);
    expect(layout.edges.map((edge) => `${edge.fromKey}->${edge.toKey}`)).toEqual(["one->three"]);
    expect(layout.height).toBe(
      layout.nodes[2].y + WORKFLOW_GRAPH_NODE_HEIGHT,
    );
  });

  it("is empty for an empty chain", () => {
    const layout = layoutWorkflowBuilderGraph([], []);
    expect(layout).toMatchObject({ nodes: [], edges: [], width: 0, height: 0 });
  });

  it("honours a hand placement, redraws its edges, and grows the content around it", () => {
    const ranked = layoutWorkflowBuilderGraph(["one", "two"], [{ from: "one", to: "two" }]);
    const moved = layoutWorkflowBuilderGraph(
      ["one", "two"],
      [{ from: "one", to: "two" }],
      { two: { x: 420, y: 30 } },
    );

    // The moved card takes the coordinate it was left at; the untouched one
    // keeps its rank, so placement overrides the layout rather than replacing it.
    expect(moved.nodes).toEqual([
      { key: "one", x: 0, y: 0, branch: false },
      { key: "two", x: 420, y: 30, branch: false },
    ]);
    expect(moved.edges[0].path).not.toBe(ranked.edges[0].path);
    expect(moved.width).toBe(420 + WORKFLOW_GRAPH_NODE_WIDTH);
    expect(moved.height).toBe(30 + WORKFLOW_GRAPH_NODE_HEIGHT);
  });

  // The tier-2 lifecycle shape: display order is [input, step-2, step-1] while
  // the authored edge still runs input -> step-1, so the wire passes behind the
  // card between them. Its midpoint lands on that card's centre — which is
  // exactly where a click meant for the card goes.
  it("keeps an edge control off a card the edge runs behind", () => {
    const layout = layoutWorkflowBuilderGraph(
      ["-input-", "step-2", "step-1"],
      [{ from: "-input-", to: "step-1" }],
    );
    const covered = layout.nodes[1];
    const [edge] = layout.edges;

    expect(edge.midpoint).toEqual({
      x: covered.x + WORKFLOW_GRAPH_NODE_WIDTH / 2,
      y: covered.y + WORKFLOW_GRAPH_NODE_HEIGHT / 2,
    });
    const insideCoveredCard = edge.control.x > covered.x
      && edge.control.x < covered.x + WORKFLOW_GRAPH_NODE_WIDTH
      && edge.control.y > covered.y
      && edge.control.y < covered.y + WORKFLOW_GRAPH_NODE_HEIGHT;
    expect(insideCoveredCard).toBe(false);
  });

  it("leaves the control on the midpoint when the wire is clear", () => {
    const layout = layoutWorkflowBuilderGraph(
      ["one", "two"],
      [{ from: "one", to: "two" }],
    );

    expect(layout.edges[0].control).toEqual(layout.edges[0].midpoint);
  });
});
