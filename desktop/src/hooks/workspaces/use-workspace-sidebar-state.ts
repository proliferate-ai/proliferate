import type { GitStatusSnapshot } from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  collectWorkspaceSessionViewStates,
  type SessionViewState,
} from "@/lib/domain/sessions/activity";
import {
  buildSidebarGroupStates,
  type SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar";
import { getEffectiveSessionTitle } from "@/lib/domain/sessions/title";
import { useLogicalWorkspaces } from "@/hooks/workspaces/use-logical-workspaces";
import { useWorkspaceBranchRenameMonitor } from "@/hooks/workspaces/use-workspace-branch-rename-monitor";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

interface UseWorkspaceSidebarStateArgs {
  showArchived: boolean;
}

interface WorkspaceSidebarState {
  groups: SidebarGroupState[];
  workspaceActivities: Record<string, SessionViewState>;
  archivedCount: number;
  selectedWorkspaceId: string | null;
  gitStatus: GitStatusSnapshot | undefined;
  transcriptTitle: string | null;
  isEmpty: boolean;
  isLoading: boolean;
}

export function useWorkspaceSidebarState({
  showArchived,
}: UseWorkspaceSidebarStateArgs): WorkspaceSidebarState {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
  const workspaceActivities = useHarnessStore(useShallow((state) =>
    collectWorkspaceSessionViewStates(state.sessionSlots)
  ));
  const activeSessionTitle = useHarnessStore((state) => {
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] : null;
    return slot ? getEffectiveSessionTitle(slot) : null;
  });

  const archivedWorkspaceIds = useWorkspaceUiStore((state) => state.archivedWorkspaceIds);
  const lastViewedAt = useWorkspaceUiStore((state) => state.lastViewedAt);
  const workspaceLastInteracted = useWorkspaceUiStore(
    (state) => state.workspaceLastInteracted,
  );

  const { logicalWorkspaces, isLoading: workspacesLoading } = useLogicalWorkspaces();
  const { data: gitStatus } = useWorkspaceBranchRenameMonitor();

  const archivedSet = useMemo(
    () => new Set(archivedWorkspaceIds),
    [archivedWorkspaceIds],
  );

  const archivedCount = useMemo(
    () => logicalWorkspaces.filter((entry) => archivedSet.has(entry.id)).length,
    [archivedSet, logicalWorkspaces],
  );

  const groups = useMemo(() => buildSidebarGroupStates({
    logicalWorkspaces,
    showArchived,
    archivedSet,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    workspaceActivities,
    gitStatus,
    activeSessionTitle,
    lastViewedAt,
    workspaceLastInteracted,
  }), [
    activeSessionTitle,
    archivedSet,
    gitStatus,
    lastViewedAt,
    logicalWorkspaces,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    showArchived,
    workspaceActivities,
    workspaceLastInteracted,
  ]);

  return {
    groups,
    workspaceActivities,
    archivedCount,
    selectedWorkspaceId,
    gitStatus,
    transcriptTitle: activeSessionTitle,
    isEmpty: groups.length === 0,
    isLoading: workspacesLoading,
  };
}
