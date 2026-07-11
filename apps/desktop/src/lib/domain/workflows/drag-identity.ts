/**
 * Stable drag/drop identity for the workflow editor (feature spec §5.1 / §12,
 * WS9b item 4).
 *
 * Editor drag state must NOT be keyed by array index or by the editable slot
 * label — renaming a lane mid-drag, or a concurrent reorder, would otherwise
 * land a drop on the wrong node. Every slot/node/group/lane/step carries a
 * stable lowercase-UUID `id` (WS9a `identity.ts`); this module mints those ids
 * for an id-less draft on load, mints ids for freshly-authored objects, and
 * resolves an id back to its CURRENT `SpineAddress`/index at drop time. The
 * spine mutators keep taking `SpineAddress`+index (cheap, unchanged); only the
 * transient drag handle is id-based.
 */

import {
  isParallelGroup,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowParallelGroup,
  type WorkflowSpineEntry,
  type WorkflowStep,
} from "@proliferate/product-domain/workflows/definition";
import { newWorkflowObjectId } from "@proliferate/product-domain/workflows/identity";
import type { SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";

/** Assign an id to a step if it has none (preserves an existing id verbatim). */
export function ensureStepId(step: WorkflowStep): WorkflowStep {
  return step.id ? step : { ...step, id: newWorkflowObjectId() };
}

/** A fresh clone of a step with a brand-new id (spec §5.1: clone creates new
 * ids). Deep-cloned so nested objects (goal, cases, args, schema) are detached. */
export function cloneStepWithNewId(step: WorkflowStep): WorkflowStep {
  const clone = JSON.parse(JSON.stringify(step)) as WorkflowStep;
  return { ...clone, id: newWorkflowObjectId() };
}

function ensureNodeIds(node: WorkflowAgentNode): WorkflowAgentNode {
  return {
    ...node,
    id: node.id ?? newWorkflowObjectId(),
    slotId: node.slotId ?? newWorkflowObjectId(),
    steps: node.steps.map(ensureStepId),
  };
}

/** A fresh agent node with ids populated (freshly-authored slot). */
export function newAgentNodeWithIds(node: Omit<WorkflowAgentNode, "id" | "slotId">): WorkflowAgentNode {
  return ensureNodeIds(node as WorkflowAgentNode);
}

/**
 * Idempotently populate every slot/node/group/lane/step id on a draft that was
 * parsed from the id-less v1 wire. Existing ids are preserved (canonical
 * round-trip); only gaps are filled with fresh UUIDv7s. Pure — returns a new
 * definition.
 */
export function ensureDefinitionIds(definition: WorkflowDefinition): WorkflowDefinition {
  const agents: WorkflowSpineEntry[] = definition.agents.map((entry) => {
    if (isParallelGroup(entry)) {
      const group: WorkflowParallelGroup = {
        ...entry,
        id: entry.id ?? newWorkflowObjectId(),
        parallel: entry.parallel.map(ensureNodeIds),
      };
      return group;
    }
    return ensureNodeIds(entry);
  });
  return { ...definition, agents };
}

/** The stable id of a spine entry (a group's `id`, or a standalone node's `id`). */
export function spineEntryId(entry: WorkflowSpineEntry): string | undefined {
  return entry.id;
}

/** Resolve a spine-entry id to its current array index, or -1 if it is gone. */
export function spineEntryIndexById(definition: WorkflowDefinition, id: string): number {
  return definition.agents.findIndex((entry) => entry.id === id);
}

/** Resolve a lane id to its current index inside the group at `spineIndex`. */
export function laneIndexById(definition: WorkflowDefinition, spineIndex: number, laneId: string): number {
  const entry = definition.agents[spineIndex];
  if (!entry || !isParallelGroup(entry)) {
    return -1;
  }
  return entry.parallel.findIndex((lane) => lane.id === laneId);
}

export interface StepLocation {
  address: SpineAddress;
  stepIndex: number;
  /** The id of the node the step lives in (drop-target guard: reorder only
   * within the same node). */
  nodeId: string | undefined;
}

/** Resolve a step id to its current node address + index, or null if it is gone. */
export function findStepById(definition: WorkflowDefinition, stepId: string): StepLocation | null {
  let idx = -1;
  for (const entry of definition.agents) {
    idx += 1;
    const nodes: { node: WorkflowAgentNode; lane: string }[] = isParallelGroup(entry)
      ? entry.parallel.map((lane) => ({ node: lane, lane: lane.slot }))
      : [{ node: entry, lane: "-" }];
    for (const { node, lane } of nodes) {
      const stepIndex = node.steps.findIndex((step) => step.id === stepId);
      if (stepIndex !== -1) {
        return { address: { spineIndex: idx, lane }, stepIndex, nodeId: node.id };
      }
    }
  }
  return null;
}

/** The stable id of the node at `address` (drop-target guard for step drags). */
export function nodeIdAt(definition: WorkflowDefinition, address: SpineAddress): string | undefined {
  const entry = definition.agents[address.spineIndex];
  if (!entry) {
    return undefined;
  }
  if (isParallelGroup(entry)) {
    return entry.parallel.find((lane) => lane.slot === address.lane)?.id;
  }
  return address.lane === "-" ? entry.id : undefined;
}
