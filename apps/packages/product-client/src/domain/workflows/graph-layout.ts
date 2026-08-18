// Pure spatial layout for the workflows canvas: where each node card sits and
// which drawn edge joins it to the next, in untransformed content coordinates.
// The canvas component owns pan/zoom; this module owns geometry only, so it
// stays free of React and measures nothing.

import type { WorkflowGraphSlotVM } from "./run-view-model";

/** Card geometry the design settles on: 200×92 cards on a 22px dot grid. */
export const WORKFLOW_GRAPH_NODE_WIDTH = 200;
export const WORKFLOW_GRAPH_NODE_HEIGHT = 92;
/** Vertical pitch between chain ranks (card height + drawn-edge room). */
const RANK_GAP = 60;
/** Horizontal pitch between lanes (card width + gutter). */
const LANE_PITCH = 236;
/** A side node hangs half a card below the rank it branches from. */
const BRANCH_DROP = 46;
/** Vertical gap between stacked side nodes on the same rank. */
const BRANCH_STACK_GAP = 12;

export interface WorkflowGraphPlacedNode {
  /** The run node-row id (or the builder node id) this placement is for. */
  key: string;
  x: number;
  y: number;
  /** Whether the card hangs off the chain (ad hoc side node). */
  branch: boolean;
}

export interface WorkflowGraphEdgeLayout {
  fromKey: string;
  toKey: string;
  kind: "chain" | "branch";
  /** SVG path in content coordinates, ready for a `<path d>` attribute. */
  path: string;
  midpoint: { x: number; y: number };
}

export interface WorkflowGraphLayout {
  nodes: WorkflowGraphPlacedNode[];
  edges: WorkflowGraphEdgeLayout[];
  width: number;
  height: number;
}

/**
 * A vertical cubic between two card ports: leaves the source's bottom-center,
 * enters the target's top-center, with the control points pulled straight
 * down/up so the curve reads as flow rather than a slack wire.
 */
function edgePath(fromX: number, fromY: number, toX: number, toY: number): string {
  const pull = Math.max(24, (toY - fromY) / 2);
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + pull}, ${toX} ${toY - pull}, ${toX} ${toY}`;
}

function bottomPort(node: WorkflowGraphPlacedNode): { x: number; y: number } {
  return { x: node.x + WORKFLOW_GRAPH_NODE_WIDTH / 2, y: node.y + WORKFLOW_GRAPH_NODE_HEIGHT };
}

function topPort(node: WorkflowGraphPlacedNode): { x: number; y: number } {
  return { x: node.x + WORKFLOW_GRAPH_NODE_WIDTH / 2, y: node.y };
}

/**
 * Lays out a run's slots as the design's graph: one rank per chain slot,
 * attempts side by side within their rank (a retry is the same chain
 * position, so it widens the rank instead of advancing it), ad hoc side
 * nodes hanging in the lane to the right of the rank they anchor to.
 *
 * Edges: one chain edge between consecutive ranks, drawn from each rank's
 * latest attempt (`buildWorkflowGraph` orders attempts oldest→newest, so the
 * last one is the row the run actually stands on); one branch edge from a
 * side node's anchor attempt — or the rank's latest attempt when the anchor
 * is not in the slot — to the side node.
 */
export function layoutWorkflowRunGraph(slots: readonly WorkflowGraphSlotVM[]): WorkflowGraphLayout {
  const nodes: WorkflowGraphPlacedNode[] = [];
  const edges: WorkflowGraphEdgeLayout[] = [];
  const placedByKey = new Map<string, WorkflowGraphPlacedNode>();
  let cursorY = 0;
  let previousRankLatest: WorkflowGraphPlacedNode | null = null;

  for (const slot of slots) {
    const rankY = cursorY;
    const placedAttempts = slot.attempts.map((vm, attemptIndex) => {
      const placed: WorkflowGraphPlacedNode = {
        key: vm.node.id,
        x: attemptIndex * LANE_PITCH,
        y: rankY,
        branch: false,
      };
      nodes.push(placed);
      placedByKey.set(placed.key, placed);
      return placed;
    });
    const rankLatest = placedAttempts.length > 0
      ? placedAttempts[placedAttempts.length - 1]
      : null;

    const branchX = Math.max(slot.attempts.length, 1) * LANE_PITCH;
    slot.adhoc.forEach((vm, adhocIndex) => {
      const placed: WorkflowGraphPlacedNode = {
        key: vm.node.id,
        x: branchX,
        y: rankY + BRANCH_DROP
          + adhocIndex * (WORKFLOW_GRAPH_NODE_HEIGHT + BRANCH_STACK_GAP),
        branch: true,
      };
      nodes.push(placed);
      placedByKey.set(placed.key, placed);
      const anchor = (vm.node.anchorNodeRowId !== null
        ? placedByKey.get(vm.node.anchorNodeRowId)
        : undefined) ?? rankLatest;
      if (anchor) {
        const from = bottomPort(anchor);
        const to = topPort(placed);
        edges.push({
          fromKey: anchor.key,
          toKey: placed.key,
          kind: "branch",
          path: edgePath(from.x, from.y, to.x, to.y),
          midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        });
      }
    });

    if (previousRankLatest && rankLatest) {
      const from = bottomPort(previousRankLatest);
      const to = topPort(rankLatest);
      edges.push({
        fromKey: previousRankLatest.key,
        toKey: rankLatest.key,
        kind: "chain",
        path: edgePath(from.x, from.y, to.x, to.y),
        midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      });
    }
    if (rankLatest) {
      previousRankLatest = rankLatest;
    }

    const rankHeight = Math.max(
      WORKFLOW_GRAPH_NODE_HEIGHT,
      slot.adhoc.length === 0
        ? 0
        : BRANCH_DROP + slot.adhoc.length * (WORKFLOW_GRAPH_NODE_HEIGHT + BRANCH_STACK_GAP) - BRANCH_STACK_GAP,
    );
    cursorY = rankY + rankHeight + RANK_GAP;
  }

  return {
    nodes,
    edges,
    width: nodes.reduce((max, node) => Math.max(max, node.x + WORKFLOW_GRAPH_NODE_WIDTH), 0),
    height: nodes.reduce((max, node) => Math.max(max, node.y + WORKFLOW_GRAPH_NODE_HEIGHT), 0),
  };
}

/**
 * Where the author has put a card by hand, in the same content coordinates the
 * deterministic placement below produces.
 */
export interface WorkflowGraphNodePlacement {
  x: number;
  y: number;
}

/**
 * Deterministic builder placement with authored, rather than implied, edges.
 *
 * A card the author has dragged keeps the coordinate they left it at; every
 * other card falls back to its rank in the chain, so hand placement is an
 * override of this layout rather than a replacement for it. Edges are derived
 * from the resulting placements, so a moved card takes its wires with it.
 */
export function layoutWorkflowBuilderGraph(
  nodeIds: readonly string[],
  edges: readonly { from: string; to: string }[],
  placements: Readonly<Record<string, WorkflowGraphNodePlacement>> = {},
): WorkflowGraphLayout {
  const nodes = nodeIds.map((id, index): WorkflowGraphPlacedNode => {
    const placement = placements[id];
    return {
      key: id,
      x: placement?.x ?? 0,
      y: placement?.y ?? index * (WORKFLOW_GRAPH_NODE_HEIGHT + RANK_GAP),
      branch: false,
    };
  });
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const laidOutEdges = edges.flatMap((edge): WorkflowGraphEdgeLayout[] => {
    const fromNode = byKey.get(edge.from);
    const toNode = byKey.get(edge.to);
    if (!fromNode || !toNode) return [];
    const from = bottomPort(fromNode);
    const to = topPort(toNode);
    return [{
      fromKey: edge.from,
      toKey: edge.to,
      kind: "chain",
      path: edgePath(from.x, from.y, to.x, to.y),
      midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    }];
  });
  return {
    nodes,
    edges: laidOutEdges,
    // Measured from the placements rather than from the chain's length: a card
    // dragged right or down has to grow the content the canvas pans and fits.
    width: nodes.reduce((max, node) => Math.max(max, node.x + WORKFLOW_GRAPH_NODE_WIDTH), 0),
    height: nodes.reduce((max, node) => Math.max(max, node.y + WORKFLOW_GRAPH_NODE_HEIGHT), 0),
  };
}
