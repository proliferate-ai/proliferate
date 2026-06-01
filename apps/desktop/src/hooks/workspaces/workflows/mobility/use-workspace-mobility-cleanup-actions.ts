import { useCallback } from "react";
import { useDestroyWorkspaceMobilitySourceMutation } from "@anyharness/sdk-react";
import { useCompleteCloudWorkspaceHandoffCleanup } from "@/hooks/access/cloud/use-complete-cloud-workspace-handoff-cleanup";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import type { WorkspaceMobilityState } from "@/hooks/workspaces/derived/mobility/use-workspace-mobility-state";

export function useWorkspaceMobilityCleanupActions(state: WorkspaceMobilityState) {
  const {
    isPending,
    mutateAsync: completeCleanup,
  } = useCompleteCloudWorkspaceHandoffCleanup();
  const cleanupWorkspace = useDestroyWorkspaceMobilitySourceMutation();
  const { clearWorkspaceRuntimeState } = useWorkspaceSelection();
  const dismissMcpNotice = useWorkspaceMobilityUiStore((store) => store.dismissMcpNotice);
  const showToast = useToastStore((store) => store.show);

  const dismissNotice = useCallback(() => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    dismissMcpNotice(state.selectedLogicalWorkspaceId);
  }, [dismissMcpNotice, state.selectedLogicalWorkspaceId]);

  const retryCleanup = useCallback(async () => {
    const handoffOpId = state.status.activeHandoff?.id;
    if (!state.mobilityWorkspaceId || !handoffOpId) {
      showToast("Cleanup can't be retried right now.");
      return;
    }

    try {
      if (state.status.activeHandoff?.direction === "local_to_cloud") {
        if (!state.localWorkspaceId) {
          showToast("Cleanup needs retry once the local runtime is connected.");
          return;
        }
        await cleanupWorkspace.mutateAsync({
          workspaceId: state.localWorkspaceId,
        });
        clearWorkspaceRuntimeState(state.localWorkspaceId);
      }
      await completeCleanup({
        mobilityWorkspaceId: state.mobilityWorkspaceId,
        handoffOpId,
      });
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Cleanup retry failed.",
      );
    }
  }, [
    cleanupWorkspace,
    clearWorkspaceRuntimeState,
    completeCleanup,
    showToast,
    state.localWorkspaceId,
    state.mobilityWorkspaceId,
    state.status.activeHandoff?.direction,
    state.status.activeHandoff?.id,
  ]);

  return {
    isRetryingCleanup: isPending || cleanupWorkspace.isPending,
    dismissNotice,
    retryCleanup,
  };
}
