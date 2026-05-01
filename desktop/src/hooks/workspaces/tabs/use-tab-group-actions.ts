import { useCallback } from "react";
import { resolveSelectedWorkspaceIdentity } from "@/lib/domain/workspaces/workspace-ui-key";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

export function useTabGroupActions() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
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
