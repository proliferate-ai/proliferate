import { useCallback } from "react";
import {
  deleteManualChatGroup,
  removeSessionsFromManualChatGroups,
  updateManualChatGroup,
  upsertManualChatGroup,
  type ManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

type ManualChatGroupUpdates = Partial<Pick<ManualChatGroup, "label" | "colorId">>;

export function useManualChatGroupActions() {
  const manualGroupsByWorkspace = useWorkspaceUiStore((state) =>
    state.manualChatGroupsByWorkspace
  );
  const setManualChatGroupsForWorkspace = useWorkspaceUiStore((state) =>
    state.setManualChatGroupsForWorkspace
  );
  const clearChatGroupCollapsedForWorkspace = useWorkspaceUiStore((state) =>
    state.clearChatGroupCollapsedForWorkspace
  );

  const upsertGroup = useCallback((workspaceId: string, group: ManualChatGroup) => {
    const current = manualGroupsByWorkspace[workspaceId] ?? [];
    setManualChatGroupsForWorkspace(workspaceId, upsertManualChatGroup(current, group));
  }, [manualGroupsByWorkspace, setManualChatGroupsForWorkspace]);

  const updateGroup = useCallback((
    workspaceId: string,
    groupId: string,
    updates: ManualChatGroupUpdates,
  ) => {
    const current = manualGroupsByWorkspace[workspaceId] ?? [];
    setManualChatGroupsForWorkspace(
      workspaceId,
      updateManualChatGroup(current, groupId, updates),
    );
  }, [manualGroupsByWorkspace, setManualChatGroupsForWorkspace]);

  const deleteGroup = useCallback((workspaceId: string, groupId: string) => {
    const current = manualGroupsByWorkspace[workspaceId] ?? [];
    setManualChatGroupsForWorkspace(workspaceId, deleteManualChatGroup(current, groupId));
    clearChatGroupCollapsedForWorkspace(workspaceId, [groupId]);
  }, [
    clearChatGroupCollapsedForWorkspace,
    manualGroupsByWorkspace,
    setManualChatGroupsForWorkspace,
  ]);

  const removeSessions = useCallback((workspaceId: string, sessionIds: string[]) => {
    const current = manualGroupsByWorkspace[workspaceId] ?? [];
    const next = removeSessionsFromManualChatGroups(current, sessionIds);
    const liveGroupIds = new Set(next.map((group) => group.id));
    const dissolvedGroupIds = current
      .map((group) => group.id)
      .filter((groupId) => !liveGroupIds.has(groupId));

    setManualChatGroupsForWorkspace(workspaceId, next);
    if (dissolvedGroupIds.length > 0) {
      clearChatGroupCollapsedForWorkspace(workspaceId, dissolvedGroupIds);
    }
  }, [
    clearChatGroupCollapsedForWorkspace,
    manualGroupsByWorkspace,
    setManualChatGroupsForWorkspace,
  ]);

  return {
    upsertGroup,
    updateGroup,
    deleteGroup,
    removeSessions,
  };
}
