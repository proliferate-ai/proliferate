import type {
  WorkflowArgumentsV2,
  WorkflowPlacementV2,
} from "@proliferate/cloud-sdk";

/**
 * The trigger input a client-minted invocation id was minted for. Declared
 * structurally rather than imported from the courier so this module stays a
 * leaf; `TriggerCourierInput` satisfies it.
 */
export interface WorkflowTriggerIdentityInput {
  workflowDefinitionId: string;
  arguments: WorkflowArgumentsV2;
  placement: WorkflowPlacementV2;
}

/**
 * Canonical key for the creation request an invocation id is bound to.
 *
 * The control plane canonicalizes the body behind an invocation id and answers
 * `409 workflow_invocation_conflict` to any replay of that id carrying a
 * different one. So retry ids may be reused only while the input still keys to
 * what they were minted under; a changed repo pick or input must mint a fresh
 * identity instead of replaying into a permanent conflict.
 *
 * Arguments are sorted by name and emitted as tuples so object key order never
 * changes the key, and values keep their JSON type: `1` and `"1"` are
 * different bodies to the control plane.
 */
export function workflowTriggerIdentityKey(
  input: WorkflowTriggerIdentityInput,
): string {
  return JSON.stringify([
    input.workflowDefinitionId,
    input.placement.repoConfigId,
    input.placement.mode,
    Object.keys(input.arguments)
      .sort()
      .map((name) => [name, input.arguments[name]]),
  ]);
}
