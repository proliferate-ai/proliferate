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
import {
  buildStartRunBody,
  type SlotSessionBinding,
} from "@proliferate/product-domain/workflows/run-launch";
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
  /** Per-slot session bindings (L29/E8). Fresh-by-default: slots omitted or
   * bound to `"new"`/null open a new session; only bound slots reach the wire
   * (spec run-from-chat R3). */
  sessionBindings?: readonly SlotSessionBinding[];
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
      const body: StartRunRequest = buildStartRunBody({
        inputs: input.args,
        targetMode: input.targetMode,
        cloudWorkspaceId: input.cloudWorkspaceId,
        sessionBindings: input.sessionBindings,
      });
      const run = await startWorkflowRun(input.workflowId, body);

      if (input.targetMode === "local") {
        if (!input.localWorkspaceId) {
          throw new Error("Choose a workspace to run this workflow in.");
        }
        // Hand the resolved plan to the local runtime, then start relaying
        // observed state and flip the server ledger to delivered.
        await createLocalWorkflowRun(
          { runtimeUrl },
          { plan: run.resolvedPlan, workspaceId: input.localWorkspaceId },
        );
        // Invariant: once the runtime accepted the plan the run is executing
        // locally, so it MUST be registered with the relay before anything that
        // can fail — otherwise a thrown delivered-mark leaves an orphaned run
        // that executes but is never relayed, stranding the server row in
        // pending_delivery forever (an unstoppable duplicate on retry). The relay
        // polls + reports observed status independent of the server's delivered
        // flag, so registration alone is enough to reconcile the row.
        register(run.id, { workspaceId: input.localWorkspaceId, runtimeUrl });
        try {
          await markWorkflowRunDelivered(run.id);
        } catch (error) {
          // Best-effort: the relay's next status report reconciles the row past
          // delivery even if this explicit mark fails.
          const errorName = error instanceof Error ? error.name : "unknown";
          console.warn("Marking local workflow run delivered failed", {
            runId: run.id,
            errorName,
          });
        }
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
