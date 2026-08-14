import type {
  WorkflowArgumentsV2,
  WorkflowInvocationCreateRequestV2,
  WorkflowInvocationV2,
  WorkflowPlacementV2,
} from "@proliferate/cloud-sdk";
import type {
  WorkflowRunProjectionV2,
  WorkflowRunPutRequestV2,
} from "@anyharness/sdk";

/**
 * Workflows gen-2 trigger courier: the two-plane placement sequence behind
 * every "run this workflow" affordance.
 *
 *   1. `PUT /v1/workflow-invocations/{id}` (control plane) freezes the
 *      definition snapshot and returns the invocation record.
 *   2. `PUT /v1/workflow-runs/{run_id}` (runtime plane) is handed a body
 *      assembled from that record's frozen fields — the definition snapshot,
 *      the server-normalized arguments, and the placement — and materializes
 *      the workspace.
 *
 * Both ids are client-minted and both routes are idempotent, so the whole
 * courier is safely re-runnable after a partial failure *as long as the
 * retry reuses the same two ids*. That is why the ids are minted before the
 * first request and travel back out on both the success and the failure
 * path (see `WorkflowTriggerError.ids`).
 */

export interface TriggerCourierDeps {
  putInvocation(
    invocationId: string,
    body: WorkflowInvocationCreateRequestV2,
  ): Promise<WorkflowInvocationV2>;
  putRun(
    runId: string,
    body: WorkflowRunPutRequestV2,
  ): Promise<WorkflowRunProjectionV2>;
  /** Fresh client-minted identity; the product binds `crypto.randomUUID`. */
  mintId(): string;
}

export interface TriggerCourierInput {
  workflowDefinitionId: string;
  arguments: WorkflowArgumentsV2;
  placement: WorkflowPlacementV2;
}

/** Ids a retry supplies to re-run the courier under the same identity. */
export interface TriggerCourierIds {
  invocationId?: string;
  runId?: string;
}

export type TriggerCourierMintedIds = Required<TriggerCourierIds>;

export type TriggerCourierStage = "invocation" | "run";

export interface TriggerCourierResult extends TriggerCourierMintedIds {
  workspaceId: string;
  projection: WorkflowRunProjectionV2;
}

/**
 * Carries the ids the failed attempt used, so the caller can retry the same
 * identity instead of minting a second invocation for one user action.
 */
export class WorkflowTriggerError extends Error {
  constructor(
    public readonly stage: TriggerCourierStage,
    public readonly ids: TriggerCourierMintedIds,
    public readonly reason: unknown,
  ) {
    super(`Workflow trigger failed while placing the ${stage}.`);
    this.name = "WorkflowTriggerError";
  }
}

/** The ids a failed trigger used, or `null` for any other error. */
export function workflowTriggerErrorIds(
  error: unknown,
): TriggerCourierMintedIds | null {
  return error instanceof WorkflowTriggerError ? error.ids : null;
}

export async function runWorkflowTrigger(
  deps: TriggerCourierDeps,
  input: TriggerCourierInput,
  ids: TriggerCourierIds = {},
): Promise<TriggerCourierResult> {
  const minted: TriggerCourierMintedIds = {
    invocationId: ids.invocationId ?? deps.mintId(),
    runId: ids.runId ?? deps.mintId(),
  };

  let invocation: WorkflowInvocationV2;
  try {
    invocation = await deps.putInvocation(minted.invocationId, {
      schemaVersion: 2,
      workflowDefinitionId: input.workflowDefinitionId,
      arguments: input.arguments,
      placement: input.placement,
    });
  } catch (reason) {
    throw new WorkflowTriggerError("invocation", minted, reason);
  }

  let projection: WorkflowRunProjectionV2;
  try {
    // The run body is assembled from the control plane's frozen record,
    // never from `input`: the record carries the definition snapshot and
    // whatever normalization the control plane applied, and the run must be
    // placed against exactly that. (The invocation response is flat, so the
    // ADR's invocation_json is reconstituted here field-for-field.)
    projection = await deps.putRun(minted.runId, {
      schemaVersion: 2,
      workflowDefinitionId: invocation.workflowDefinitionId,
      definition: invocation.definition,
      arguments: invocation.arguments,
      placement: invocation.placement,
    });
  } catch (reason) {
    throw new WorkflowTriggerError("run", minted, reason);
  }

  return {
    ...minted,
    workspaceId: projection.run.workspaceId,
    projection,
  };
}
