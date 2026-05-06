import { useCallback } from "react";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

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
