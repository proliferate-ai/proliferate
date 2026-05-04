import type { GitStatusSnapshot } from "@anyharness/sdk";
import type { Workspace } from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type SidebarSessionActivityState,
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
import { useWorkspaceMetadataSync } from "@/hooks/workspaces/use-workspace-metadata-sync";
import { useWorkspaceFinishSuggestions } from "@/hooks/workspaces/use-workspace-finish-suggestions";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useWorkspaceSidebarActivityStatesWithErrorAttention } from "@/hooks/workspaces/use-workspace-sidebar-activities";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";

interface UseWorkspaceSidebarStateArgs {
  showArchived: boolean;
}

interface WorkspaceSidebarState {
  groups: SidebarGroupState[];
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  archivedCount: number;
  selectedWorkspaceId: string | null;
  selectedLogicalWorkspaceId: string | null;
  gitStatus: GitStatusSnapshot | undefined;
  transcriptTitle: string | null;
  emptyState: SidebarEmptyState;
  cleanupAttentionWorkspaces: Workspace[];
  isLoading: boolean;
}

const EMPTY_WORKSPACES: Workspace[] = [];

const EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION: Record<string, string> = {};

export function useWorkspaceSidebarState({
  showArchived,
}: UseWorkspaceSidebarStateArgs): WorkspaceSidebarState {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
  const lastViewedSessionErrorAtBySession = useWorkspaceUiStore((state) =>
    state.lastViewedSessionErrorAtBySession
    ?? EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION
  );
  const workspaceActivities = useWorkspaceSidebarActivityStatesWithErrorAttention(
    lastViewedSessionErrorAtBySession,
  );
  const deferredLaunchesById = useDeferredHomeLaunchStore((state) => state.launches);
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
  const { data: workspaceCollections } = useWorkspaces();
  const cleanupAttentionWorkspaces =
    workspaceCollections?.cleanupAttentionWorkspaces ?? EMPTY_WORKSPACES;
  const finishSuggestionsByWorkspaceId = useWorkspaceFinishSuggestions(workspaceCollections);
  const { repoRoots } = useStandardRepoProjection();
  const { data: gitStatus } = useWorkspaceMetadataSync();

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
  const pendingPromptCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const launch of Object.values(deferredLaunchesById)) {
      counts[launch.workspaceId] = (counts[launch.workspaceId] ?? 0) + 1;
    }
    return counts;
  }, [deferredLaunchesById]);

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
    pendingPromptCounts,
    gitStatus,
    activeSessionTitle,
    lastViewedAt,
    workspaceLastInteracted,
    finishSuggestionsByWorkspaceId,
  }), [
    activeSessionTitle,
    archivedSet,
    gitStatus,
    hiddenRepoRootSet,
    lastViewedAt,
    logicalWorkspaces,
    pendingPromptCounts,
    repoRoots,
    workspaceTypes,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    showArchived,
    workspaceActivities,
    workspaceLastInteracted,
    finishSuggestionsByWorkspaceId,
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
    cleanupAttentionWorkspaces,
    isLoading: workspacesLoading,
  };
}
