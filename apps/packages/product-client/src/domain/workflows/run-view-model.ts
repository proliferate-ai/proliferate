// Pure view-model derivation for the workflows gen-2 run view. This module is
// the client's transcription of the ADR's transition table: a control renders
// only where the table has a legal row for it, so a 409 from the runtime is a
// race with the run, never a UI bug. Keep this file free of React and fetch;
// it may import only AnyHarness contract types and local domain modules.

import type {
  WorkflowRunNodeStatusV2,
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunV2,
} from "@anyharness/sdk";

/**
 * Tone vocabulary local to the domain layer (mirrors gen-1's
 * run-presentation.ts pattern); the node card maps these onto StatusDot
 * tones at the component layer.
 */
export type WorkflowNodeTone =
  | "muted"
  | "current"
  | "info"
  | "success"
  | "warning"
  | "danger";

const NODE_STATUS_TONE: Record<WorkflowRunNodeStatusV2, WorkflowNodeTone> = {
  pending: "muted",
  running: "current",
  needs_attention: "warning",
  awaiting_human: "info",
  completed: "success",
  failed: "danger",
};

export function workflowNodeStatusTone(
  status: WorkflowRunNodeStatusV2,
): WorkflowNodeTone {
  return NODE_STATUS_TONE[status];
}

export interface WorkflowNodeControlSet {
  approve: boolean;
  failRedo: boolean;
  flipToAgent: boolean;
  flipToHuman: boolean;
  addAdhoc: boolean;
}

/** A run the user can still act on: every non-terminal state. */
export function workflowRunIsActive(run: WorkflowRunV2): boolean {
  return (
    run.status === "running" ||
    run.status === "awaiting_human" ||
    run.status === "interrupted"
  );
}

/**
 * The transition table, verbatim, as control eligibility:
 * - ApproveGate and FlipType-to-agent are legal only on awaiting_human.
 * - FlipType-to-human_in_loop is legal only on a running agent node.
 * - FailAndRedo is legal from failed, needs_attention, and awaiting_human.
 * - AddAdhocNode is legal on any active (non-terminal) run; it anchors to a
 *   node card but is run-scoped, so every card on an active run offers it.
 */
export function workflowNodeControls(
  run: WorkflowRunV2,
  node: WorkflowRunNodeV2,
): WorkflowNodeControlSet {
  const active = workflowRunIsActive(run);
  return {
    approve: node.status === "awaiting_human",
    failRedo:
      node.status === "failed" ||
      node.status === "needs_attention" ||
      node.status === "awaiting_human",
    flipToAgent:
      node.status === "awaiting_human" && node.nodeType === "human_in_loop",
    flipToHuman: node.status === "running" && node.nodeType === "agent",
    addAdhoc: active,
  };
}

export interface WorkflowGraphNodeVM {
  node: WorkflowRunNodeV2;
  isCurrent: boolean;
  tone: WorkflowNodeTone;
  controls: WorkflowNodeControlSet;
}

/**
 * One position on the linear chain: the defined node plus every replacement
 * that ever ran in its place (attempts render side by side, never hidden in
 * a counter), plus the ad hoc side nodes anchored to any of them.
 */
export interface WorkflowGraphSlotVM {
  chainIndex: number;
  attempts: WorkflowGraphNodeVM[];
  adhoc: WorkflowGraphNodeVM[];
}

function toNodeVM(run: WorkflowRunV2, node: WorkflowRunNodeV2): WorkflowGraphNodeVM {
  return {
    node,
    isCurrent: run.currentNodeRowId === node.id,
    tone: workflowNodeStatusTone(node.status),
    controls: workflowNodeControls(run, node),
  };
}

function byCreatedAt(a: WorkflowRunNodeV2, b: WorkflowRunNodeV2): number {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}

/**
 * Groups a projection's node rows into ordered chain slots. Defined and
 * replacement rows share their chain position (replacements inherit it);
 * adhoc rows attach to the slot their anchor occupies. Rows with a null
 * chainIndex (contractually impossible for defined nodes) sort last rather
 * than vanish, so a bad projection stays visible instead of silently
 * shrinking the graph.
 */
export function buildWorkflowGraph(
  projection: WorkflowRunProjectionV2,
): WorkflowGraphSlotVM[] {
  const { run, nodes } = projection;
  const slots = new Map<number, WorkflowGraphSlotVM>();
  const slotFor = (chainIndex: number): WorkflowGraphSlotVM => {
    let slot = slots.get(chainIndex);
    if (!slot) {
      slot = { chainIndex, attempts: [], adhoc: [] };
      slots.set(chainIndex, slot);
    }
    return slot;
  };

  const FALLBACK_INDEX = Number.MAX_SAFE_INTEGER;
  const chainRows = nodes.filter((node) => node.kind !== "adhoc");
  const adhocRows = nodes.filter((node) => node.kind === "adhoc");

  for (const node of [...chainRows].sort(byCreatedAt)) {
    slotFor(node.chainIndex ?? FALLBACK_INDEX).attempts.push(toNodeVM(run, node));
  }
  for (const node of [...adhocRows].sort(byCreatedAt)) {
    slotFor(node.chainIndex ?? FALLBACK_INDEX).adhoc.push(toNodeVM(run, node));
  }

  return [...slots.values()].sort((a, b) => a.chainIndex - b.chainIndex);
}

export interface WorkflowAutoAdvance {
  completedNode: WorkflowRunNodeV2;
  startedNode: WorkflowRunNodeV2;
}

/**
 * Detects an agent auto-advance between two polled projections: the current
 * node moved, the previous current node now reads completed, it was an agent
 * node, and it was *running* when last seen. Both human-driven advances read
 * as deliberate and get no undo toast: a completed human_in_loop node, and an
 * agent node approved out of awaiting_human (an ApproveGate). Returns null on
 * first load, no movement, or any non-auto advance.
 */
export function detectWorkflowAutoAdvance(
  previous: WorkflowRunProjectionV2 | undefined,
  next: WorkflowRunProjectionV2,
): WorkflowAutoAdvance | null {
  if (!previous) return null;
  const previousCurrentId = previous.run.currentNodeRowId;
  const nextCurrentId = next.run.currentNodeRowId;
  if (!previousCurrentId || !nextCurrentId) return null;
  if (previousCurrentId === nextCurrentId) return null;
  const completedNode = next.nodes.find((node) => node.id === previousCurrentId);
  const startedNode = next.nodes.find((node) => node.id === nextCurrentId);
  if (!completedNode || !startedNode) return null;
  if (completedNode.status !== "completed") return null;
  if (completedNode.nodeType !== "agent") return null;
  const previousRow = previous.nodes.find((node) => node.id === previousCurrentId);
  if (previousRow?.status !== "running") return null;
  return { completedNode, startedNode };
}
