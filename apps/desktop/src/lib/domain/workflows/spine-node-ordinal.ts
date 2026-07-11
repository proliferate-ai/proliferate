/**
 * Shared pure indexing helpers for the workflow editor's spine (WS0B-U split
 * of `WorkflowEditorScreen.tsx`) — both the spine canvas (agent-invalid
 * badges) and the agent inspector (slot-issue lookup) need the same node
 * ordinal `validateWorkflowDefinition` uses to attach agent-level issues.
 */

import {
  iterSpineNodes,
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
