import { useCallback } from "react";
import { rightPanelToolHeaderKey } from "@/lib/domain/workspaces/shell/right-panel-model";
import { useGitPanelUiStore } from "@/stores/editor/git-panel-ui-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import type { WorkspaceMobilityState } from "@/hooks/workspaces/derived/mobility/use-workspace-mobility-state";

export function useWorkspaceMobilityFooterGitPanelAction(
  mobilityState: WorkspaceMobilityState,
) {
  const setRightPanelMaterializedForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelMaterializedForWorkspace,
  );
  const setRightPanelOpenForWorkspace = useWorkspaceUiStore(
    (state) => state.setRightPanelOpenForWorkspace,
  );
  const requestGitPanelMode = useGitPanelUiStore((state) => state.requestModeForWorkspace);

  return useCallback(() => {
    const sourceWorkspaceId = mobilityState.confirmSnapshot?.sourceWorkspaceId
      ?? mobilityState.resolvedWorkspaceId;
    const workspaceUiKey = mobilityState.selectedLogicalWorkspaceId
      ?? sourceWorkspaceId;
    if (!sourceWorkspaceId || !workspaceUiKey) {
      return;
    }
    const gitEntryKey = rightPanelToolHeaderKey("git");
    setRightPanelMaterializedForWorkspace(sourceWorkspaceId, (previous) => ({
      ...previous,
      activeEntryKey: gitEntryKey,
      headerOrder: previous.headerOrder.includes(gitEntryKey)
        ? previous.headerOrder
        : [...previous.headerOrder, gitEntryKey],
    }));
    setRightPanelOpenForWorkspace(workspaceUiKey, true);
    requestGitPanelMode(sourceWorkspaceId, "unstaged");
  }, [
    mobilityState.confirmSnapshot?.sourceWorkspaceId,
    mobilityState.resolvedWorkspaceId,
    mobilityState.selectedLogicalWorkspaceId,
    requestGitPanelMode,
    setRightPanelMaterializedForWorkspace,
    setRightPanelOpenForWorkspace,
  ]);
}
