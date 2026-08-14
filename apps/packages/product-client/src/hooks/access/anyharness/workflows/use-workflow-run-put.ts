import type {
  AnyHarnessRequestOptions,
  WorkflowRunProjectionV2,
  WorkflowRunPutRequestV2,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { putWorkflowRun } from "#product/lib/access/anyharness/workflow-runs";
import { WorkflowRuntimeNotConnectedError } from "#product/lib/domain/workflows/workflow-trigger-failure";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

export type WorkflowRunPut = (
  runId: string,
  body: WorkflowRunPutRequestV2,
  options?: AnyHarnessRequestOptions,
) => Promise<WorkflowRunProjectionV2>;

/**
 * React-facing seam for placing a gen-2 run on the local runtime. The
 * connection is the tracked runtime URL, not a workspace-resolved target:
 * the run's workspace does not exist until this PUT materializes it.
 *
 * No React Query wrapper here on purpose — the response is the full run
 * projection, and the run views' own `@anyharness/sdk-react` hooks own that
 * cache once the caller navigates to the placed run.
 */
export function useWorkflowRunPut(): WorkflowRunPut {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useCallback<WorkflowRunPut>((runId, body, options) => {
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (!trimmedRuntimeUrl) {
      return Promise.reject(new WorkflowRuntimeNotConnectedError());
    }
    return putWorkflowRun({ runtimeUrl: trimmedRuntimeUrl }, runId, body, options);
  }, [runtimeUrl]);
}
