import type { startCloudWorkspace } from "@proliferate/cloud-sdk/client/workspaces";
import type { isCloudWorkspaceNotReadyError } from "@/hooks/access/cloud/use-cloud-workspace-connection";
import { resolveCloudWorkspaceStatus } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import { cancelLatencyFlow } from "@/lib/infra/measurement/latency-flow";
import { resolveSelectionConnection } from "@/hooks/workspaces/workflows/selection/connection";
import { isWorkspaceSelectionCurrent } from "@/hooks/workspaces/workflows/selection/guards";
import type {
  ReadyCloudReadinessResult,
  WorkspaceConnectionResult,
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
} from "@/hooks/workspaces/workflows/selection/types";

export interface CloudSelectionConnectionDeps {
  isCloudWorkspaceNotReadyError: typeof isCloudWorkspaceNotReadyError;
  resolveSelectionConnection: typeof resolveSelectionConnection;
  startCloudWorkspace: typeof startCloudWorkspace;
}

export async function resolveCloudSelectionConnectionWithStartRetry(
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

    const startedWorkspace = await deps.startCloudWorkspace(input.cloudReadiness.cloudWorkspaceId);
    const startedWorkspaceStatus = resolveCloudWorkspaceStatus(startedWorkspace);
    await input.selectionDeps.cache.invalidateCloudWorkspaceStartState(input.runtimeUrl);
    if (!isWorkspaceSelectionCurrent(input.context.workspaceId, input.context.selectionNonce)) {
      cancelLatencyFlow(input.latencyFlowId, "workspace_selection_stale");
      return null;
    }
    if (startedWorkspaceStatus !== "ready") {
      cancelLatencyFlow(input.latencyFlowId, "cloud_workspace_start_pending", {
        cloudWorkspaceId: input.cloudReadiness.cloudWorkspaceId,
        status: startedWorkspaceStatus,
      });
      return null;
    }

    return await deps.resolveSelectionConnection(
      input.selectionDeps,
      input.context,
      input.cloudReadiness,
    );
  }
}
