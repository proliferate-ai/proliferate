import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { resolvePostMoveNavigation } from "@/lib/domain/workspaces/move/move-model";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

// A successful move may have just destroyed the source workspace (worktree source
// fate), leaving the shell pointed at a dead id. Mirror useWorkspaceRetireActions.
// markDone's clear-selection idiom and the collision panel's "Open the cloud
// workspace" navigation: if this move's source is still the on-screen workspace, hand
// off to the new cloud workspace (falling back to home when its id is unknown).
export function usePostMoveNavigation(workspaceId: string | null) {
  const navigate = useNavigate();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();
  const clearSelection = useSessionSelectionStore((state) => state.clearSelection);
  const setSelectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.setSelectedLogicalWorkspaceId,
  );

  return useCallback((destinationCloudWorkspaceId: string | null) => {
    if (!workspaceId) return;
    const navigation = resolvePostMoveNavigation({
      movedWorkspaceId: workspaceId,
      selectedWorkspaceId: useSessionSelectionStore.getState().selectedWorkspaceId,
      destinationCloudWorkspaceId,
    });
    if (navigation.kind === "select_cloud") {
      selectWorkspaceFromSurface(
        cloudWorkspaceSyntheticId(navigation.cloudWorkspaceId),
        "workspace-move-dialog",
      );
    } else if (navigation.kind === "home") {
      clearSelection();
      setSelectedLogicalWorkspaceId(null);
      navigate(APP_ROUTES.home);
    }
  }, [clearSelection, navigate, selectWorkspaceFromSurface, setSelectedLogicalWorkspaceId, workspaceId]);
}
