import { useCallback } from "react";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useTabGroupActions() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const toggleChatGroupCollapsedForWorkspace = useWorkspaceUiStore(
    (state) => state.toggleChatGroupCollapsedForWorkspace,
  );

  const toggleGroupCollapsed = useCallback((parentSessionId: string) => {
    if (!selectedWorkspaceId) {
      return false;
    }
    toggleChatGroupCollapsedForWorkspace(selectedWorkspaceId, parentSessionId);
    return true;
  }, [selectedWorkspaceId, toggleChatGroupCollapsedForWorkspace]);

  return {
    toggleGroupCollapsed,
  };
}
