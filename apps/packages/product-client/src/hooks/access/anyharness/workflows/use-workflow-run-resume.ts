import type {
  AnyHarnessRequestOptions,
  WorkflowRunProjectionV2,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { resumeWorkflowRun } from "#product/lib/access/anyharness/workflow-runs";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

export type WorkflowRunResume = (
  runId: string,
  options?: AnyHarnessRequestOptions,
) => Promise<WorkflowRunProjectionV2>;

/**
 * React-facing seam for resuming a gen-2 run from outside its own run view.
 * The startup resume popover lists interrupted runs across every workspace
 * and resumes whichever one the user picks, so it cannot bind a single run id
 * at mount the way `useWorkflowRunMutations(runId).resume` does — this is the
 * sibling access hook `use-workflow-run-put.ts`'s own doc comment anticipates.
 *
 * Same runtime-URL connection and the same "no React Query wrapper" call as
 * `useWorkflowRunPut`: the popover dismisses the run and navigates off this
 * call's own response, so there is no run-detail cache here worth owning.
 */
export function useWorkflowRunResume(): WorkflowRunResume {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useCallback<WorkflowRunResume>((runId, options) => {
    const trimmedRuntimeUrl = runtimeUrl.trim();
    if (!trimmedRuntimeUrl) {
      return Promise.reject(new Error("The local runtime is not connected yet."));
    }
    return resumeWorkflowRun({ runtimeUrl: trimmedRuntimeUrl }, runId, options);
  }, [runtimeUrl]);
}
