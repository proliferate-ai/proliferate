import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelWorkflowRun } from "@/lib/access/cloud/workflows";
import { workflowRunDetailKey, workflowRunsKey } from "./query-keys";

/**
 * Take over / cancel a run (spec 3.6, run view "Cancel run" — the same
 * server endpoint the held-composer's take-over action routes through).
 * Works for both target modes: the server write going terminal is itself
 * the release, so a stale local relay just reconciles on its next report.
 */
export function useCancelWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { runId: string }>({
    mutationFn: async ({ runId }) => {
      await cancelWorkflowRun(runId);
    },
    onSuccess: async (_data, { runId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowRunDetailKey(runId) }),
        queryClient.invalidateQueries({ queryKey: workflowRunsKey(null) }),
      ]);
    },
  });
}
