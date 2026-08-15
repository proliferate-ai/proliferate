import {
  WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY,
  WORKFLOW_TRIGGER_RUNTIME_DISCONNECTED_COPY,
  WORKFLOW_TRIGGER_TIMEOUT_COPY,
  workflowTriggerFailureCopy,
} from "#product/copy/workflows/workflow-trigger-failure-copy";
import {
  inspectWorkflowCloudError,
  inspectWorkflowRuntimeError,
} from "#product/lib/domain/workflows/workflow-run-state";

/** Which plane a gen-2 trigger failed on; `TriggerCourierStage` satisfies it. */
export type WorkflowTriggerFailureStage = "invocation" | "run";

/**
 * No runtime is tracked, so the run PUT was never attempted. A distinct class
 * rather than a message the caller matches on: the sentence a person reads is
 * copy, and copy is not a wire contract.
 */
export class WorkflowRuntimeNotConnectedError extends Error {
  constructor() {
    super("The local runtime is not connected.");
    this.name = "WorkflowRuntimeNotConnectedError";
  }
}

/**
 * The sentence for a failed trigger submit.
 *
 * Both planes are classified from their own envelope: the control plane puts
 * `status`/`code` at the top level of `ProliferateClientError`, the runtime
 * puts them under `AnyHarnessError.problem`. Reading only the former is why
 * every runtime failure used to render one generic sentence.
 *
 * `stage` is what makes an uncoded failure legible: a `TypeError` is what
 * `fetch` throws when nothing answers, and on the run stage that is the local
 * runtime being unreachable rather than anything about the workflow.
 */
export function workflowTriggerFailureMessage(
  error: unknown,
  stage: WorkflowTriggerFailureStage | null = null,
): string {
  if (isAbortError(error)) {
    return WORKFLOW_TRIGGER_TIMEOUT_COPY;
  }
  if (error instanceof WorkflowRuntimeNotConnectedError) {
    return WORKFLOW_TRIGGER_RUNTIME_DISCONNECTED_COPY;
  }
  const runtimeError = inspectWorkflowRuntimeError(error);
  if (runtimeError) {
    return workflowTriggerFailureCopy(runtimeError.code);
  }
  const cloudError = inspectWorkflowCloudError(error);
  if (cloudError) {
    return workflowTriggerFailureCopy(cloudError.code);
  }
  if (stage === "run" && error instanceof TypeError) {
    return WORKFLOW_TRIGGER_RUNTIME_DISCONNECTED_COPY;
  }
  return WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY;
}

function isAbortError(error: unknown): boolean {
  return error !== null
    && typeof error === "object"
    && "name" in error
    && error.name === "AbortError";
}
