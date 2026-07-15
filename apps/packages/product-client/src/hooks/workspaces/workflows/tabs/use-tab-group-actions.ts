import { useCallback } from "react";
import { resolveSelectedWorkspaceIdentity } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function useTabGroupActions() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { workspaceUiKey } = resolveSelectedWorkspaceIdentity({
    selectedLogicalWorkspaceId,
    materializedWorkspaceId: selectedWorkspaceId,
  });
  const toggleChatGroupCollapsedForWorkspace = useWorkspaceUiStore(
    (state) => state.toggleChatGroupCollapsedForWorkspace,
  );

  const toggleGroupCollapsed = useCallback((parentSessionId: string) => {
    if (!workspaceUiKey) {
      return false;
    }
    toggleChatGroupCollapsedForWorkspace(workspaceUiKey, parentSessionId);
    return true;
  }, [toggleChatGroupCollapsedForWorkspace, workspaceUiKey]);

  return {
    toggleGroupCollapsed,
  };
}
