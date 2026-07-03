import { useMutation, useQueryClient } from "@tanstack/react-query";
// Side-effect: registers the auth-aware desktop cloud client factory.
import "@/lib/access/cloud/client";
import {
  markWorkflowRunDelivered,
  startWorkflowRun,
  type StartRunRequest,
  type WorkflowRunResponse,
} from "@/lib/access/cloud/workflows";
import { createLocalWorkflowRun } from "@/lib/access/anyharness/workflow-runs";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useWorkflowRelayStore } from "@/stores/workflows/workflow-relay-store";
import { workflowRunsKey, workflowsRootKey } from "./query-keys";

export type LaunchArgValue = string | number | boolean;

export interface LaunchWorkflowRunInput {
  workflowId: string;
  args: Record<string, LaunchArgValue>;
  targetMode: WorkflowTargetMode;
  /** Local runtime workspace id — required for `local` runs. */
  localWorkspaceId?: string;
  /** Cloud workspace id (server-side) — required for `personal_cloud` runs. */
  cloudWorkspaceId?: string;
}

/**
 * Launch a workflow run across both delivery lanes (spec 3.2):
 *
 * - `local`: StartRun (server pins + resolves) → POST the resolved plan to the
 *   LOCAL runtime → tell the server it was delivered → register the run with the
 *   relay so observed transitions flow back to the server.
 * - `personal_cloud`: StartRun carries `targetWorkspaceId`; the server delivers
 *   gateway-direct to the sandbox in the request, so the client only navigates.
 */
export function useLaunchWorkflowRun() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const register = useWorkflowRelayStore((state) => state.register);

  return useMutation<WorkflowRunResponse, Error, LaunchWorkflowRunInput>({
    mutationFn: async (input) => {
      const body: StartRunRequest = {
        args: input.args,
        targetMode: input.targetMode,
        ...(input.targetMode === "personal_cloud" && input.cloudWorkspaceId
          ? { targetWorkspaceId: input.cloudWorkspaceId }
          : {}),
      };
      const run = await startWorkflowRun(input.workflowId, body);

      if (input.targetMode === "local") {
        if (!input.localWorkspaceId) {
          throw new Error("Choose a workspace to run this workflow in.");
        }
        // Hand the resolved plan to the local runtime, then flip the server ledger
        // to delivered and start relaying observed state.
        await createLocalWorkflowRun(
          { runtimeUrl },
          { plan: run.resolvedPlan, workspaceId: input.localWorkspaceId },
        );
        await markWorkflowRunDelivered(run.id);
        register(run.id, { workspaceId: input.localWorkspaceId, runtimeUrl });
      }

      return run;
    },
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowsRootKey() }),
        queryClient.invalidateQueries({ queryKey: workflowRunsKey(run.workflowId) }),
        queryClient.invalidateQueries({ queryKey: workflowRunsKey(null) }),
      ]);
    },
  });
}
