import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveLocalWorkflowApproval } from "@/lib/access/anyharness/workflow-runs";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { workflowRunDetailKey } from "./query-keys";

export interface ResolveApprovalVariables {
  runId: string;
  approve: boolean;
}

/**
 * Resolve a workflow `human.approval` step for a LOCAL run (spec 3.6): approve/
 * deny hit the local runtime directly; the relay then reports the resulting
 * status back to the server. Cloud-run approvals are not wired in v1.
 */
export function useResolveWorkflowApproval() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const queryClient = useQueryClient();

  return useMutation<void, Error, ResolveApprovalVariables>({
    mutationFn: async ({ runId, approve }) => {
      await resolveLocalWorkflowApproval({ runtimeUrl }, runId, approve);
    },
    onSuccess: async (_data, { runId }) => {
      await queryClient.invalidateQueries({ queryKey: workflowRunDetailKey(runId) });
    },
  });
}
