import type { GitStatusSnapshot } from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  collectWorkspaceSessionViewStates,
  type SessionViewState,
} from "@/lib/domain/sessions/activity";
import {
  buildSidebarGroupStates,
  resolveSidebarEmptyState,
  type SidebarEmptyState,
  type SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar";
import { getEffectiveSessionTitle } from "@/lib/domain/sessions/title";
import { useLogicalWorkspaces } from "@/hooks/workspaces/use-logical-workspaces";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
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
  selectedLogicalWorkspaceId: string | null;
  gitStatus: GitStatusSnapshot | undefined;
  transcriptTitle: string | null;
  emptyState: SidebarEmptyState;
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

  const {
    archivedWorkspaceIds,
    hiddenRepoRootIds,
    lastViewedAt,
    workspaceLastInteracted,
    workspaceTypes,
  } = useWorkspaceUiStore(useShallow((state) => ({
    archivedWorkspaceIds: state.archivedWorkspaceIds,
    hiddenRepoRootIds: state.hiddenRepoRootIds,
    lastViewedAt: state.lastViewedAt,
    workspaceLastInteracted: state.workspaceLastInteracted,
    workspaceTypes: state.workspaceTypes,
  })));

  const { logicalWorkspaces, isLoading: workspacesLoading } = useLogicalWorkspaces();
  const { repoRoots } = useStandardRepoProjection();
  const { data: gitStatus } = useWorkspaceBranchRenameMonitor();

  const archivedSet = useMemo(
    () => new Set(archivedWorkspaceIds),
    [archivedWorkspaceIds],
  );
  const hiddenRepoRootSet = useMemo(
    () => new Set(hiddenRepoRootIds),
    [hiddenRepoRootIds],
  );

  const archivedCount = useMemo(
    () => logicalWorkspaces.filter((entry) => archivedSet.has(entry.id)).length,
    [archivedSet, logicalWorkspaces],
  );

  const groups = useMemo(() => buildSidebarGroupStates({
    repoRoots,
    logicalWorkspaces,
    showArchived,
    workspaceTypes,
    archivedSet,
    hiddenRepoRootIds: hiddenRepoRootSet,
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
    hiddenRepoRootSet,
    lastViewedAt,
    logicalWorkspaces,
    repoRoots,
    workspaceTypes,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    showArchived,
    workspaceActivities,
    workspaceLastInteracted,
  ]);
  const emptyState = resolveSidebarEmptyState(logicalWorkspaces.length, groups.length);

  return {
    groups,
    workspaceActivities,
    archivedCount,
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
    gitStatus,
    transcriptTitle: activeSessionTitle,
    emptyState,
    isLoading: workspacesLoading,
  };
}
