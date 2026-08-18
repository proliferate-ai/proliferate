import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import { useStandardRepoProjection } from "#product/hooks/workspaces/derived/use-standard-repo-projection";
import {
  buildSidebarGroupStates,
} from "#product/lib/domain/workspaces/sidebar/sidebar-groups";
import {
  SIDEBAR_REPO_GROUP_ITEM_LIMIT,
} from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import {
  numberedSidebarShortcutTargetIds,
  visibleSidebarShortcutTargetIds,
} from "#product/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceSidebarShowMoreStore } from "#product/stores/workspaces/workspace-sidebar-show-more-store";

const EMPTY_WORKSPACE_ACTIVITIES = {};
const EMPTY_PENDING_PROMPT_COUNTS = {};
const EMPTY_LAST_VIEWED_AT = {};

export interface SidebarShortcutTargets {
  digitTargetIds: string[];
  traversalTargetIds: string[];
}

export function useSidebarShortcutTargets(): SidebarShortcutTargets {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const { repoRoots } = useStandardRepoProjection();
  const { cloudComputeEnabled } = useAppCapabilities();
  const {
    pinnedWorkspaceIds,
    hiddenRepoRootIds,
    collapsedRepoGroups,
    repositoriesCollapsed,
    workspaceTypes,
    workspaceLastInteracted,
  } = useWorkspaceUiStore(useShallow((state) => ({
    pinnedWorkspaceIds: state.pinnedWorkspaceIds,
    hiddenRepoRootIds: state.hiddenRepoRootIds,
    collapsedRepoGroups: state.collapsedRepoGroups,
    repositoriesCollapsed: state.repositoriesCollapsed,
    workspaceTypes: state.workspaceTypes,
    workspaceLastInteracted: state.workspaceLastInteracted,
  })));
  const repoGroupsShownMore = useWorkspaceSidebarShowMoreStore(
    (state) => state.repoGroupsShownMore,
  );

  const hiddenRepoRootSet = useMemo(
    () => new Set(hiddenRepoRootIds),
    [hiddenRepoRootIds],
  );
  const pinnedSet = useMemo(
    () => new Set(pinnedWorkspaceIds),
    [pinnedWorkspaceIds],
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
    showArchived: false,
    workspaceTypes,
    pinnedSet,
    hiddenRepoRootIds: hiddenRepoRootSet,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    workspaceActivities: EMPTY_WORKSPACE_ACTIVITIES,
    pendingPromptCounts: EMPTY_PENDING_PROMPT_COUNTS,
    gitStatus: undefined,
    activeSessionTitle: null,
    lastViewedAt: EMPTY_LAST_VIEWED_AT,
    workspaceLastInteracted,
    cloudComputeEnabled,
  }), [
    cloudComputeEnabled,
    hiddenRepoRootSet,
    logicalWorkspaces,
    pinnedSet,
    repoRoots,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    workspaceLastInteracted,
    workspaceTypes,
  ]);

  return useMemo(() => ({
    digitTargetIds: numberedSidebarShortcutTargetIds({
      groups,
      pinnedWorkspaceIds,
      collapsedRepoGroupKeys,
      repoGroupsShownMore: repoGroupsShownMoreKeys,
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
      repositoriesCollapsed,
    }),
    traversalTargetIds: visibleSidebarShortcutTargetIds({
      groups,
      collapsedRepoGroupKeys,
      repoGroupsShownMore: repoGroupsShownMoreKeys,
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
      repositoriesCollapsed,
    }),
  }), [
    collapsedRepoGroupKeys,
    groups,
    pinnedWorkspaceIds,
    repoGroupsShownMoreKeys,
    repositoriesCollapsed,
  ]);
}
