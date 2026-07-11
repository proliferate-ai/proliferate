import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelWorkflowRun } from "@/lib/access/cloud/workflows";
import { cancelLocalWorkflowRun } from "@/lib/access/anyharness/workflow-runs";
import { useWorkflowRelayStore } from "@/stores/workflows/workflow-relay-store";
import { workflowRunDetailKey, workflowRunsKey } from "./query-keys";

/**
 * Take over / cancel a run (spec 3.6, run view "Cancel run" — the same
 * server endpoint the held-composer's take-over action routes through).
 * Works for both target modes: the server write going terminal is itself
 * the release, so a stale local relay just reconciles on its next report.
 *
 * For a LOCAL run this desktop is relaying, the server only does the terminal
 * DB write — it can't reach the local runtime — so we must nudge the runtime
 * ourselves or the agent keeps running behind a cancelled row. We cancel the
 * runtime FIRST, then the server: the invariant is that the row must not go
 * terminal while the local agent is still live. Runtime cancel is best-effort
 * (swallow + log) so a runtime hiccup never blocks the authoritative server
 * cancel — a leftover local agent still reconciles via the relay's next report.
 */
export function useCancelWorkflowRun() {
  const queryClient = useQueryClient();
  const getRelayRun = useWorkflowRelayStore((state) => state.runs);

  return useMutation<void, Error, { runId: string }>({
    mutationFn: async ({ runId }) => {
      const registration = getRelayRun[runId];
      if (registration) {
        try {
          await cancelLocalWorkflowRun(
            { runtimeUrl: registration.runtimeUrl },
            runId,
          );
        } catch (error) {
          const errorName = error instanceof Error ? error.name : "unknown";
          console.warn("Local workflow runtime cancel failed", { runId, errorName });
        }
      }
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
