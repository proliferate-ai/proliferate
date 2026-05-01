import { useCallback } from "react";
import {
  partitionWorkspaceShellTabKeys,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useShellTabOrderActions({
  workspaceId,
}: {
  workspaceId: string | null;
}) {
  const reorderOpenTabs = useWorkspaceFilesStore((state) => state.reorderOpenTabs);
  const setVisibleChatSessionIdsForWorkspace = useWorkspaceUiStore(
    (state) => state.setVisibleChatSessionIdsForWorkspace,
  );
  const setShellTabOrder = useWorkspaceUiStore((state) => state.setShellTabOrderForWorkspace);

  const reorderShellTabs = useCallback((nextKeys: WorkspaceShellTabKey[]) => {
    if (!workspaceId) {
      return;
    }
    const { chatSessionIds, filePaths } = partitionWorkspaceShellTabKeys(nextKeys);
    setShellTabOrder(workspaceId, nextKeys);
    setVisibleChatSessionIdsForWorkspace(workspaceId, chatSessionIds);
    reorderOpenTabs(filePaths);
  }, [
    reorderOpenTabs,
    setShellTabOrder,
    setVisibleChatSessionIdsForWorkspace,
    workspaceId,
  ]);

  return {
    reorderShellTabs,
  };
}
