/**
 * Pure editor-state mutation helpers for the agents spine (format v2, D-031a).
 *
 * The spine is `WorkflowSpineEntry[]`: a mix of standalone agent nodes and
 * parallel groups (`{parallel: [...]}`, 2+ nodes). Every editor mutation that
 * touches "the node at this position" needs to work uniformly whether that
 * position is a standalone node (lane `"-"`) or a lane inside a group — these
 * helpers are that uniform addressing layer, kept dependency-free from React so
 * they round-trip through `parseWorkflowDefinition`/`serializeWorkflowDefinition`
 * and validate against `validateWorkflowDefinition` in a plain vitest tier.
 */

import {
  isParallelGroup,
  type WorkflowAgentNode,
  type WorkflowSpineEntry,
} from "./definition";

/** Addresses one agent node in the spine: its spine entry + lane (`"-"` for a
 * standalone node, the node's own slot for a lane inside a parallel group). */
export interface SpineAddress {
  spineIndex: number;
  lane: string;
}

/** The agent node at `address`, or `null` if the address no longer resolves
 * (e.g. the spine changed shape since the address was captured). */
export function getSpineNode(
  agents: readonly WorkflowSpineEntry[],
  address: SpineAddress,
): WorkflowAgentNode | null {
  const entry = agents[address.spineIndex];
  if (!entry) {
    return null;
  }
  if (isParallelGroup(entry)) {
    return entry.parallel.find((node) => node.slot === address.lane) ?? null;
  }
  return address.lane === "-" ? entry : null;
}

/** Replace the agent node at `address` via `updater`; a no-op (returns the same
 * array reference) if the address doesn't resolve. */
export function withSpineNode(
  agents: readonly WorkflowSpineEntry[],
  address: SpineAddress,
  updater: (node: WorkflowAgentNode) => WorkflowAgentNode,
): WorkflowSpineEntry[] {
  const entry = agents[address.spineIndex];
  if (!entry) {
    return [...agents];
  }
  return agents.map((candidate, i) => {
    if (i !== address.spineIndex) {
      return candidate;
    }
    if (isParallelGroup(candidate)) {
      return {
        parallel: candidate.parallel.map((node) =>
          node.slot === address.lane ? updater(node) : node,
        ),
      };
    }
    return address.lane === "-" ? updater(candidate) : candidate;
  });
}

/** A fresh, unused agent slot name (`agent_2`, `agent_3`, ...) given every node
 * across the whole spine (standalone nodes and every lane). */
export function nextAgentSlot(agents: readonly WorkflowSpineEntry[]): string {
  const used = new Set<string>();
  let count = 0;
  for (const entry of agents) {
    if (isParallelGroup(entry)) {
      for (const node of entry.parallel) {
        used.add(node.slot);
        count += 1;
      }
    } else {
      used.add(entry.slot);
      count += 1;
    }
  }
  let n = count + 1;
  let candidate = `agent_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `agent_${n}`;
  }
  return candidate;
}

/**
 * Wrap the standalone node at `spineIndex` into a parallel group alongside
 * `newNode` (D-031a: a group needs 2+ nodes) — "add agent in parallel". A
 * no-op if the entry at `spineIndex` is already a group (use `addLane`).
 */
export function parallelizeSpineEntry(
  agents: readonly WorkflowSpineEntry[],
  spineIndex: number,
  newNode: WorkflowAgentNode,
): WorkflowSpineEntry[] {
  const entry = agents[spineIndex];
  if (!entry || isParallelGroup(entry)) {
    return [...agents];
  }
  const next: WorkflowSpineEntry[] = [...agents];
  next[spineIndex] = { parallel: [entry, newNode] };
  return next;
}

/** Add another lane to the parallel group at `spineIndex`. A no-op if that
 * entry isn't a group. */
export function addLaneToGroup(
  agents: readonly WorkflowSpineEntry[],
  spineIndex: number,
  newNode: WorkflowAgentNode,
): WorkflowSpineEntry[] {
  const entry = agents[spineIndex];
  if (!entry || !isParallelGroup(entry)) {
    return [...agents];
  }
  const next: WorkflowSpineEntry[] = [...agents];
  next[spineIndex] = { parallel: [...entry.parallel, newNode] };
  return next;
}

/**
 * Remove one lane from the group at `spineIndex`. Dissolves the group back
 * into a standalone node when only one lane remains (D-031a: a group is
 * 2+ nodes, never 1) — the spine entry becomes that lone node directly, byte-
 * identical to a workflow that was never parallelized.
 */
export function removeLaneFromGroup(
  agents: readonly WorkflowSpineEntry[],
  spineIndex: number,
  lane: string,
): WorkflowSpineEntry[] {
  const entry = agents[spineIndex];
  if (!entry || !isParallelGroup(entry)) {
    return [...agents];
  }
  const remaining = entry.parallel.filter((node) => node.slot !== lane);
  if (remaining.length === entry.parallel.length) {
    return [...agents];
  }
  const next: WorkflowSpineEntry[] = [...agents];
  next[spineIndex] = remaining.length === 1 ? remaining[0]! : { parallel: remaining };
  return next;
}

/** Delete the whole spine entry at `spineIndex` (a standalone node, or an
 * entire parallel group). To delete just one lane, use `removeLaneFromGroup`. */
export function removeSpineEntry(
  agents: readonly WorkflowSpineEntry[],
  spineIndex: number,
): WorkflowSpineEntry[] {
  return agents.filter((_, i) => i !== spineIndex);
}
