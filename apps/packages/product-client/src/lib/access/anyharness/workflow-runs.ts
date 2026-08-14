import type {
  AnyHarnessRequestOptions,
  WorkflowRunPutRequestV2,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
} from "@anyharness/sdk-react";

/**
 * Raw runtime-plane access for Workflows gen-2 runs. Only the trigger's
 * `putRun` lives here: every read and every node/lifecycle command already
 * has a generic React hook in `@anyharness/sdk-react`
 * (`useWorkflowRunQuery`/`useWorkflowRunMutations`), which the run views use
 * directly. The trigger cannot, because its run id is minted at submit time
 * while those hooks bind a run id at mount time.
 */
export function putWorkflowRun(
  connection: AnyHarnessClientConnection,
  runId: string,
  body: WorkflowRunPutRequestV2,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).workflowRunsV2.putRun(runId, body, options);
}
