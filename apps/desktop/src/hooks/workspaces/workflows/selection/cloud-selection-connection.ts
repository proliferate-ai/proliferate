import type { isCloudWorkspaceNotReadyError } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { cancelLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import { resolveSelectionConnection } from "@/hooks/workspaces/workflows/selection/connection";
import type {
  ReadyCloudReadinessResult,
  WorkspaceConnectionResult,
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
} from "@/hooks/workspaces/workflows/selection/types";

export interface CloudSelectionConnectionDeps {
  isCloudWorkspaceNotReadyError: typeof isCloudWorkspaceNotReadyError;
  resolveSelectionConnection: typeof resolveSelectionConnection;
}

export async function resolveCloudSelectionConnectionWithStatusRefresh(
  input: {
    cloudReadiness: ReadyCloudReadinessResult;
    context: WorkspaceSelectionContext;
    latencyFlowId: string | null | undefined;
    runtimeUrl: string;
    selectionDeps: WorkspaceSelectionDeps;
  },
  deps: CloudSelectionConnectionDeps,
): Promise<WorkspaceConnectionResult | null> {
  try {
    return await deps.resolveSelectionConnection(
      input.selectionDeps,
      input.context,
      input.cloudReadiness,
    );
  } catch (error) {
    if (
      input.cloudReadiness.kind !== "cloud-ready"
      || !deps.isCloudWorkspaceNotReadyError(error)
    ) {
      throw error;
    }

    await input.selectionDeps.cache.invalidateCloudWorkspaceStartState(input.runtimeUrl);
    cancelLatencyFlow(input.latencyFlowId, "cloud_workspace_connection_not_ready", {
      cloudWorkspaceId: input.cloudReadiness.cloudWorkspaceId,
    });
    return null;
  }
}
