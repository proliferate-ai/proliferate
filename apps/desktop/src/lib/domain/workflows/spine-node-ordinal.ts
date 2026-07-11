/**
 * Shared pure indexing helpers for the workflow editor's spine (WS0B-U split
 * of `WorkflowEditorScreen.tsx`) — both the spine canvas (agent-invalid
 * badges) and the agent inspector (slot-issue lookup) need the same node
 * ordinal `validateWorkflowDefinition` uses to attach agent-level issues.
 */

import {
  isParallelGroup,
  iterSpineNodes,
  type WorkflowAgentNode,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import type { SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";

/** The flattened NODE ordinal (across every standalone node and every lane, in
 * flatten order) for `address` — matches `validateWorkflowDefinition`'s
 * `nodeIndex` counter, used to attach agent-level issues (slot/harness/model). */
export function nodeOrdinalFor(definition: WorkflowDefinition, address: SpineAddress): number {
  return iterSpineNodes(definition).findIndex(
    (entry) => entry.spineIndex === address.spineIndex && entry.lane === address.lane,
  );
}

/** The flattened run-order step index (across the whole agents spine, lanes
 * lane-grouped in lane order) for a given (spineIndex, lane, stepIndex) —
 * matches `validateWorkflowDefinition`'s indexing (L30 / D-031). */
export function flatStepIndex(
  definition: WorkflowDefinition,
  address: SpineAddress,
  stepIndex: number,
): number {
  let flat = 0;
  for (let i = 0; i < address.spineIndex; i += 1) {
    const entry = definition.agents[i]!;
    flat += isParallelGroup(entry)
      ? entry.parallel.reduce((n, node) => n + node.steps.length, 0)
      : entry.steps.length;
  }
  const entry = definition.agents[address.spineIndex];
  if (entry && isParallelGroup(entry)) {
    for (const node of entry.parallel) {
      if (node.slot === address.lane) {
        break;
      }
      flat += node.steps.length;
    }
  }
  return flat + stepIndex;
}

/** The routed-connector summary after a standalone agent: its branch step's
 * taken (continue) case + the values that end the run, in plain English. */
export function routeAfter(node: WorkflowAgentNode): { taken: string; others?: string } | null {
  const branch = node.steps.find((step) => step.kind === "branch");
  if (!branch || branch.kind !== "branch" || !branch.on) {
    return null;
  }
  const taken = Object.entries(branch.cases).find(([, c]) => c.to === "continue");
  if (!taken) {
    return null;
  }
  const ends = Object.entries(branch.cases)
    .filter(([, c]) => c.to === "end")
    .map(([value]) => `"${value}"`);
  return {
    taken: `${branch.on} is "${taken[0]}"`,
    others: ends.length > 0 ? `${ends.join(", ")} ends the run` : undefined,
  };
}
