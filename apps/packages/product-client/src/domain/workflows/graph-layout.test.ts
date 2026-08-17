import { describe, expect, it } from "vitest";
import type { WorkflowRunNodeV2 } from "@anyharness/sdk";

import type { WorkflowGraphNodeVM, WorkflowGraphSlotVM } from "./run-view-model";
import {
  layoutWorkflowChainGraph,
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

describe("layoutWorkflowChainGraph", () => {
  it("lays a chain straight down with one edge per neighbour pair", () => {
    const layout = layoutWorkflowChainGraph(["one", "two", "three"]);

    expect(layout.nodes.map((node) => node.x)).toEqual([0, 0, 0]);
    expect(layout.edges.map((edge) => `${edge.fromKey}->${edge.toKey}`)).toEqual([
      "one->two",
      "two->three",
    ]);
    expect(layout.height).toBe(
      layout.nodes[2].y + WORKFLOW_GRAPH_NODE_HEIGHT,
    );
  });

  it("is empty for an empty chain", () => {
    const layout = layoutWorkflowChainGraph([]);
    expect(layout).toMatchObject({ nodes: [], edges: [], width: 0, height: 0 });
  });
});
