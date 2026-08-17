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
import type { WorkflowRunTone } from "./run-presentation";

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
  // Terminal-inert, same as `pending`: the user stopped it deliberately, it
  // is not an error to flag the way `failed` is.
  cancelled: "muted",
};

/**
 * The map above is declared total over the union so adding a status to the
 * contract is a compile error here rather than a hole. The *read* is partial on
 * purpose: the union is the contract, not a guarantee about the bytes on the
 * wire. A runtime ahead of this client (or a stale prebuilt binary behind it)
 * can serialize a status this build has never heard of, and an undefined tone
 * would travel to `StatusDot`'s own tone map, index it with `undefined`, and
 * throw inside render — which the single root `AppErrorBoundary` escalates from
 * "one odd node card" to the whole client dropping into crash recovery. So the
 * lookup goes through a partial view (TypeScript would otherwise insist the
 * `??` is dead code) and an unknown status reads as `muted`: an inert dot, the
 * same tone `pending` already uses.
 */
export function workflowNodeStatusTone(
  status: WorkflowRunNodeStatusV2,
): WorkflowNodeTone {
  const byStatus: Partial<Record<string, WorkflowNodeTone>> = NODE_STATUS_TONE;
  return byStatus[status] ?? "muted";
}

export interface WorkflowNodeControlSet {
  approve: boolean;
  failRedo: boolean;
  flipToAgent: boolean;
  flipToHuman: boolean;
  addAdhoc: boolean;
}

/**
 * Tone for the run's own status, worn beside its label on the pane header.
 * Speaks `run-presentation.ts`'s `WorkflowRunTone` vocabulary so the component
 * layer maps it through the shared `workflowRunStatusDotTone`. Same
 * total-declaration / partial-read discipline as `NODE_STATUS_TONE`: an
 * unknown status from a newer runtime lands on `neutral` instead of a hole.
 */
const RUN_STATUS_TONE: Record<WorkflowRunV2["status"], WorkflowRunTone> = {
  running: "info",
  awaiting_human: "info",
  interrupted: "warning",
  completed: "success",
  failed: "danger",
  // Terminal-inert, same reasoning as NODE_STATUS_TONE's `cancelled`: a
  // deliberate stop, not an error; matches the unknown-status fallback.
  cancelled: "neutral",
};

export function workflowRunStatusTone(status: WorkflowRunV2["status"]): WorkflowRunTone {
  const byStatus: Partial<Record<string, WorkflowRunTone>> = RUN_STATUS_TONE;
  return byStatus[status] ?? "neutral";
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
 * Narrower than `workflowRunIsActive`, and only for the side-node affordance:
 * an interrupted run is parked, so offering "add side node" there invites the
 * user to grow a run that is not moving. The runtime would accept the command
 * (only `completed`/`failed` are terminal there, per the command wall in
 * `transition.rs`), so this is a deliberate product narrowing rather than a
 * legality claim — withholding a legal control cannot produce a 409, it just
 * declines to offer one. Split from `workflowRunIsActive` rather than narrowing
 * it, because "the run is still live" is the right reading for the resume
 * banner and for anything else that asks whether the run has finished.
 */
export function workflowRunTakesSideNode(run: WorkflowRunV2): boolean {
  return run.status === "running" || run.status === "awaiting_human";
}

/**
 * Whether a row hangs off the chain instead of sitting on it. Ad hoc rows
 * "never advance or block the run" (ADR), and the runtime enforces exactly
 * that: every chain-shaped command is rejected for `kind == Adhoc`
 * (`transition.rs` — FlipType "adhoc nodes have no gate semantics to flip",
 * UndoAdvance, and AddAdhocNode "adhoc nodes anchor to the chain, not to each
 * other"), while ApproveGate additionally requires the row to be the run's
 * current node, which an ad hoc row never becomes. FailAndRedo is the one
 * command legal on an ad hoc row (Ruling K): it re-runs the row by minting
 * another ad hoc node.
 *
 * `kind` alone decides it. A replacement is always a chain row: the only
 * producer of `kind: "replacement"` is the Redo transition on a chain row,
 * which mints it with `anchor_node_row_id: None` and the failed row's
 * inherited `chain_index`; redoing an ad hoc row mints another ad hoc row
 * (fix-wave Ruling K), never a replacement — so no replacement can descend
 * from a side node. The `anchorNodeRowId` clause is a belt on a
 * contract that cannot break today: if some future runtime does mint an
 * anchored replacement, reading it as a side node withholds chain controls
 * instead of offering an advance from a copied `chainIndex`, which is the safe
 * direction to be wrong in.
 */
export function workflowNodeIsSideNode(node: WorkflowRunNodeV2): boolean {
  return (
    node.kind === "adhoc" ||
    (node.kind === "replacement" && node.anchorNodeRowId !== null)
  );
}

/**
 * A side node's card carries exactly one control: Fail & redo. Gate, flip, and
 * advance semantics are chain-only (an ad hoc row never becomes
 * `current_node_row_id`, has no gate to flip, and cannot anchor another ad hoc
 * row — the runtime refuses all three), so rendering them would turn this
 * module's one invariant inside out: a 409 would stop being a race with the
 * run and become a button that cannot ever work. Redo is the ruled recovery
 * path for a wedged or failed side node (Ruling K): the runtime accepts
 * FailAndRedo on an ad hoc row in `failed|needs_attention` and mints another
 * ad hoc node anchored the same.
 */
function sideNodeControls(node: WorkflowRunNodeV2): WorkflowNodeControlSet {
  return {
    approve: false,
    failRedo:
      node.status === "failed" || node.status === "needs_attention",
    flipToAgent: false,
    flipToHuman: false,
    addAdhoc: false,
  };
}

/**
 * The transition table, verbatim, as control eligibility — for chain rows,
 * which are the only rows any of these commands accept:
 * - ApproveGate and FlipType-to-agent are legal only on awaiting_human.
 * - FlipType-to-human_in_loop is legal only on a running agent node.
 * - FailAndRedo is legal from failed, needs_attention, and awaiting_human.
 * - AddAdhocNode anchors to a node card but is run-scoped, so every chain card
 *   on a run that takes side nodes offers it.
 *
 * Status and node type do not decide alone: `kind` gates first, because a side
 * node copies its anchor's `chainIndex` and would otherwise render chain
 * controls that read as legal and are not.
 */
export function workflowNodeControls(
  run: WorkflowRunV2,
  node: WorkflowRunNodeV2,
): WorkflowNodeControlSet {
  if (workflowNodeIsSideNode(node)) {
    return sideNodeControls(node);
  }
  return {
    approve: node.status === "awaiting_human",
    failRedo:
      node.status === "failed" ||
      node.status === "needs_attention" ||
      node.status === "awaiting_human",
    flipToAgent:
      node.status === "awaiting_human" && node.nodeType === "human_in_loop",
    flipToHuman: node.status === "running" && node.nodeType === "agent",
    addAdhoc: workflowRunTakesSideNode(run),
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
  // Placement reads the same predicate the controls do: a row rendered with a
  // side node's (empty) control set must sit off the chain too, or the graph
  // would show a chain-positioned card that silently offers nothing.
  const chainRows = nodes.filter((node) => !workflowNodeIsSideNode(node));
  const adhocRows = nodes.filter((node) => workflowNodeIsSideNode(node));

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
