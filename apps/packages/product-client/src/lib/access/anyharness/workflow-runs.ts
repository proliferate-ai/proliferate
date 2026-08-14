import type {
  AnyHarnessRequestOptions,
  WorkflowRunPutRequestV2,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
} from "@anyharness/sdk-react";

/**
 * Raw runtime-plane access for Workflows gen-2 runs. Every read and every
 * node/lifecycle command already has a generic React hook in
 * `@anyharness/sdk-react` (`useWorkflowRunQuery`/`useWorkflowRunMutations`),
 * which the run views use directly — but two callers cannot bind to those
 * hooks' one-run-id-per-mount shape, so they call the client here instead:
 *
 * - The trigger's `putRun`: its run id is minted at submit time, while the
 *   hook binds a run id at mount time.
 * - The startup resume popover's `resumeWorkflowRun`: it lists interrupted
 *   runs across every workspace and resumes whichever one the user clicks,
 *   so there is no single run id to bind a hook to at mount.
 */
export function putWorkflowRun(
  connection: AnyHarnessClientConnection,
  runId: string,
  body: WorkflowRunPutRequestV2,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workflowRunsV2.putRun(runId, body, options);
}

export function resumeWorkflowRun(
  connection: AnyHarnessClientConnection,
  runId: string,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workflowRunsV2.resume(runId, options);
}
