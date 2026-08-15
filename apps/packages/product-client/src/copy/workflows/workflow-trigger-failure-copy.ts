import type { WorkflowRunProblemCodeV2 } from "@anyharness/sdk";

/**
 * Authored strings for a failed Workflows gen-2 trigger, kept beside
 * `workflow-trigger-copy.ts` and shaped like
 * `copy/workspaces/workspace-availability-copy.ts`: the code-to-sentence map
 * is copy, so it lives with the copy rather than in the classifier that reads
 * the error.
 *
 * Both planes are represented, because one submit crosses both: the control
 * plane's invocation PUT (snake_case codes) and the runtime's run PUT
 * (SCREAMING_SNAKE ProblemDetails codes).
 */

/**
 * Declared as an exhaustive Record over the SDK's own union, so a new runtime
 * code is a type error here instead of silently collapsing to the fallback.
 */
const RUNTIME_FAILURE_COPY: Record<WorkflowRunProblemCodeV2, string> = {
  WORKFLOW_RUN_NOT_FOUND:
    "That run is no longer on this runtime. Start the workflow again to place a new run.",
  WORKFLOW_NODE_NOT_FOUND:
    "A step this run needs is missing from the saved workflow. Open the workflow, check its steps, then start it again.",
  WORKFLOW_TRANSITION_ILLEGAL:
    "This run has already moved on from that step. Open the run to see where it is now.",
  WORKFLOW_SNAPSHOT_INVALID:
    "This workflow cannot run as saved. Open it in the editor, fix the steps it reports, then start it again.",
  WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED:
    "The workspace for this run could not be created. Check the selected repository is still on disk, then start the run again.",
};

const CLOUD_FAILURE_COPY: Record<string, string> = {
  workflow_invocation_conflict:
    "That run was already started with different inputs. Start it again to place a new run.",
  invalid_workflow_invocation:
    "These inputs were rejected. Check the required inputs and the selected repository, then start the run again.",
};

const TRIGGER_FAILURE_COPY: Record<string, string> = {
  ...RUNTIME_FAILURE_COPY,
  ...CLOUD_FAILURE_COPY,
};

export const WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY =
  "The run could not be started. Try again in a moment.";

export const WORKFLOW_TRIGGER_RUNTIME_DISCONNECTED_COPY =
  "The local runtime is not connected. Reconnect it, then start this run again.";

export const WORKFLOW_TRIGGER_TIMEOUT_COPY =
  "The request timed out. The run may still have been placed, so check this workflow's runs before starting another.";

/** The sentence for a coded trigger failure from either plane. */
export function workflowTriggerFailureCopy(code: string | null | undefined): string {
  if (!code) {
    return WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY;
  }
  return TRIGGER_FAILURE_COPY[code] ?? WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY;
}
