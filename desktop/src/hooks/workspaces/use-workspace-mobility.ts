import { useCallback, useMemo } from "react";
import { useWorkspaceMobilityUiStore } from "@/stores/workspaces/workspace-mobility-ui-store";
import { useCloudWorkspaceHandoffHeartbeatLoop } from "@/hooks/workspaces/mobility/use-cloud-workspace-handoff-heartbeat-loop";
import { useCloudToLocalHandoff } from "@/hooks/workspaces/mobility/use-cloud-to-local-handoff";
import { useLocalToCloudHandoff } from "@/hooks/workspaces/mobility/use-local-to-cloud-handoff";
import { useWorkspaceMobilityState } from "@/hooks/workspaces/mobility/use-workspace-mobility-state";

export function useWorkspaceMobility() {
  const state = useWorkspaceMobilityState();
  const clearConfirmSnapshot = useWorkspaceMobilityUiStore((store) => store.clearConfirmSnapshot);
  const dismissMcpNotice = useWorkspaceMobilityUiStore((store) => store.dismissMcpNotice);
  const localToCloud = useLocalToCloudHandoff({
    logicalWorkspace: state.selectedLogicalWorkspace,
    logicalWorkspaceId: state.selectedLogicalWorkspaceId,
    localWorkspaceId: state.localWorkspaceId,
    mobilityWorkspaceId: state.mobilityWorkspaceId,
  });
  const cloudToLocal = useCloudToLocalHandoff({
    logicalWorkspace: state.selectedLogicalWorkspace,
    logicalWorkspaceId: state.selectedLogicalWorkspaceId,
    cloudMaterializationId: state.cloudMaterializationId,
    mobilityWorkspaceId: state.mobilityWorkspaceId,
  });

  useCloudWorkspaceHandoffHeartbeatLoop({
    mobilityWorkspaceId: state.mobilityWorkspaceId,
    handoffOpId: state.mobilityWorkspaceDetail?.activeHandoff?.id
      ?? state.selectedLogicalWorkspace?.mobilityWorkspace?.activeHandoff?.id
      ?? null,
    enabled: state.status.phase !== "idle"
      && state.status.phase !== "failed"
      && state.status.phase !== "cleanup_failed"
      && state.status.phase !== "success",
  });

  const openDialog = useCallback(async () => {
    if (state.canMoveToCloud) {
      await localToCloud.prepare();
      return;
    }
    if (state.canBringBackLocal) {
      await cloudToLocal.prepare();
    }
  }, [cloudToLocal, localToCloud, state.canBringBackLocal, state.canMoveToCloud]);

  const confirmDialog = useCallback(async () => {
    if (!state.confirmSnapshot) {
      return;
    }

    if (state.confirmSnapshot.direction === "local_to_cloud") {
      await localToCloud.confirm(state.confirmSnapshot);
      return;
    }

    await cloudToLocal.confirm(state.confirmSnapshot);
  }, [cloudToLocal, localToCloud, state.confirmSnapshot]);

  const closeDialog = useCallback(() => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    clearConfirmSnapshot(state.selectedLogicalWorkspaceId);
  }, [clearConfirmSnapshot, state.selectedLogicalWorkspaceId]);

  const dismissNotice = useCallback(() => {
    if (!state.selectedLogicalWorkspaceId) {
      return;
    }
    dismissMcpNotice(state.selectedLogicalWorkspaceId);
  }, [dismissMcpNotice, state.selectedLogicalWorkspaceId]);

  const action = useMemo(() => {
    if (state.canMoveToCloud) {
      return {
        label: "Move to cloud",
        description: "Move this workspace to a cloud runtime.",
        disabledReason: null,
      };
    }
    if (state.canBringBackLocal) {
      return {
        label: "Bring back local",
        description: "Bring this workspace back to your local runtime.",
        disabledReason: null,
      };
    }
    if (!state.repoBacked) {
      return {
        label: "Move to cloud",
        description: "Workspace mobility is only available for repo-backed workspaces.",
        disabledReason: "Workspace mobility is only available for repo-backed workspaces.",
      };
    }
    if (state.selectedLogicalWorkspace?.effectiveOwner === "cloud" && !state.selectedLogicalWorkspace.repoRoot?.id) {
      return {
        label: "Bring back local",
        description: "Clone this repo locally before bringing it back.",
        disabledReason: "Clone this repo locally before bringing it back.",
      };
    }
    return {
      label: state.selectedLogicalWorkspace?.effectiveOwner === "cloud"
        ? "Bring back local"
        : "Move to cloud",
      description: "Workspace mobility is currently unavailable.",
      disabledReason: "Workspace mobility is currently unavailable.",
    };
  }, [state.canBringBackLocal, state.canMoveToCloud, state.repoBacked, state.selectedLogicalWorkspace]);

  return {
    ...state,
    action,
    isPending: localToCloud.isPending || cloudToLocal.isPending,
    openDialog,
    confirmDialog,
    closeDialog,
    dismissNotice,
  };
}
