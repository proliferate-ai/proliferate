import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLogicalWorkspaces } from "@/hooks/workspaces/use-logical-workspaces";
import { useStandardRepoProjection } from "@/hooks/workspaces/use-standard-repo-projection";
import {
  buildSidebarGroupStates,
  SIDEBAR_REPO_GROUP_ITEM_LIMIT,
} from "@/lib/domain/workspaces/sidebar/sidebar";
import { visibleSidebarShortcutTargetIds } from "@/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceSidebarShowMoreStore } from "@/stores/workspaces/workspace-sidebar-show-more-store";

const EMPTY_WORKSPACE_ACTIVITIES = {};
const EMPTY_PENDING_PROMPT_COUNTS = {};
const EMPTY_LAST_VIEWED_AT = {};
const EMPTY_FINISH_SUGGESTIONS = {};

export function useSidebarShortcutTargets(): string[] {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const { repoRoots } = useStandardRepoProjection();
  const {
    archivedWorkspaceIds,
    hiddenRepoRootIds,
    collapsedRepoGroups,
    showArchived,
    workspaceTypes,
    workspaceLastInteracted,
  } = useWorkspaceUiStore(useShallow((state) => ({
    archivedWorkspaceIds: state.archivedWorkspaceIds,
    hiddenRepoRootIds: state.hiddenRepoRootIds,
    collapsedRepoGroups: state.collapsedRepoGroups,
    showArchived: state.showArchived,
    workspaceTypes: state.workspaceTypes,
    workspaceLastInteracted: state.workspaceLastInteracted,
  })));
  const repoGroupsShownMore = useWorkspaceSidebarShowMoreStore(
    (state) => state.repoGroupsShownMore,
  );

  const archivedSet = useMemo(
    () => new Set(archivedWorkspaceIds),
    [archivedWorkspaceIds],
  );
  const hiddenRepoRootSet = useMemo(
    () => new Set(hiddenRepoRootIds),
    [hiddenRepoRootIds],
  );
  const collapsedRepoGroupKeys = useMemo(
    () => new Set(collapsedRepoGroups),
    [collapsedRepoGroups],
  );
  const repoGroupsShownMoreKeys = useMemo(
    () => new Set(repoGroupsShownMore),
    [repoGroupsShownMore],
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
    workspaceActivities: EMPTY_WORKSPACE_ACTIVITIES,
    pendingPromptCounts: EMPTY_PENDING_PROMPT_COUNTS,
    gitStatus: undefined,
    activeSessionTitle: null,
    lastViewedAt: EMPTY_LAST_VIEWED_AT,
    workspaceLastInteracted,
    finishSuggestionsByWorkspaceId: EMPTY_FINISH_SUGGESTIONS,
  }), [
    archivedSet,
    hiddenRepoRootSet,
    logicalWorkspaces,
    repoRoots,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    showArchived,
    workspaceLastInteracted,
    workspaceTypes,
  ]);

  return useMemo(() => visibleSidebarShortcutTargetIds({
    groups,
    collapsedRepoGroupKeys,
    repoGroupsShownMore: repoGroupsShownMoreKeys,
    itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
  }), [
    collapsedRepoGroupKeys,
    groups,
    repoGroupsShownMoreKeys,
  ]);
}
