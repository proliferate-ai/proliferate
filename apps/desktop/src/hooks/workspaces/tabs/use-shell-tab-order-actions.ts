import { useCallback } from "react";
import {
  partitionWorkspaceShellTabKeys,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useShellTabOrderActions({
  workspaceId,
}: {
  workspaceId: string | null;
}) {
  const reorderOpenTargets = useWorkspaceViewerTabsStore((state) => state.reorderOpenTargets);
  const setVisibleChatSessionIdsForWorkspace = useWorkspaceUiStore(
    (state) => state.setVisibleChatSessionIdsForWorkspace,
  );
  const setShellTabOrder = useWorkspaceUiStore((state) => state.setShellTabOrderForWorkspace);

  const reorderShellTabs = useCallback((nextKeys: WorkspaceShellTabKey[]) => {
    if (!workspaceId) {
      return;
    }
    const { chatSessionIds, viewerTargetKeys } = partitionWorkspaceShellTabKeys(nextKeys);
    setShellTabOrder(workspaceId, nextKeys);
    setVisibleChatSessionIdsForWorkspace(workspaceId, chatSessionIds);
    reorderOpenTargets(viewerTargetKeys);
  }, [
    reorderOpenTargets,
    setShellTabOrder,
    setVisibleChatSessionIdsForWorkspace,
    workspaceId,
  ]);

  return {
    reorderShellTabs,
  };
}
