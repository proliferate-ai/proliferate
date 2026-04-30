import { useCallback } from "react";
import { useCompleteCloudWorkspaceHandoffCleanup } from "@/hooks/cloud/use-complete-cloud-workspace-handoff-cleanup";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";
import type { WorkspaceMobilityState } from "./use-workspace-mobility-state";

export function useWorkspaceMobilityCleanupActions(state: WorkspaceMobilityState) {
  const {
    isPending,
    mutateAsync: completeCleanup,
  } = useCompleteCloudWorkspaceHandoffCleanup();
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
    completeCleanup,
    showToast,
    state.mobilityWorkspaceId,
    state.status.activeHandoff?.id,
  ]);

  return {
    isRetryingCleanup: isPending,
    dismissNotice,
    retryCleanup,
  };
}
