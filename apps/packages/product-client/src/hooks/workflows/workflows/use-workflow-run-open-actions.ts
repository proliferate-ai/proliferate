import type { ManagedWorkflowOpenTarget } from "@proliferate/cloud-sdk";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { useCloudWorkspaceActions } from "#product/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";

export interface WorkflowRunOpenResult {
  opened: boolean;
  message?: string;
}

export function useWorkflowRunOpenActions() {
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();

  const openWorkflowRunSession = async (
    target: ManagedWorkflowOpenTarget,
  ): Promise<WorkflowRunOpenResult> => {
    try {
      const workspace = await refreshCloudWorkspace(target.cloudWorkspaceId);
      if (
        workspace.id !== target.cloudWorkspaceId
        || workspace.productLifecycle !== "active"
        || workspace.workspaceStatus === "archived"
        || workspace.anyharnessWorkspaceId !== target.anyharnessWorkspaceId
      ) {
        return unavailable();
      }
      const result = await openWorkspaceSession({
        workspaceId: cloudWorkspaceSyntheticId(target.cloudWorkspaceId),
        sessionId: target.sessionId,
      });
      return result.result === "completed" ? { opened: true } : unavailable();
    } catch {
      return unavailable();
    }
  };

  return { openWorkflowRunSession };
}

function unavailable(): WorkflowRunOpenResult {
  return {
    opened: false,
    message: "This workflow session is no longer available.",
  };
}
