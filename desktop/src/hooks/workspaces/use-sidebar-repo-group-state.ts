import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  findLogicalWorkspace,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/logical-workspaces";
import {
  resolveAutoShowMoreRepoKey,
  SIDEBAR_REPO_GROUP_ITEM_LIMIT,
  type SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar";
import { useLogicalWorkspaces } from "@/hooks/workspaces/use-logical-workspaces";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceSidebarShowMoreStore } from "@/stores/workspaces/workspace-sidebar-show-more-store";

interface UseSidebarRepoGroupStateArgs {
  groups: SidebarGroupState[];
  selectedLogicalWorkspaceId: string | null;
}

export function useSidebarRepoGroupState({
  groups,
  selectedLogicalWorkspaceId,
}: UseSidebarRepoGroupStateArgs) {
  const {
    selectedWorkspaceId,
    workspaceSelectionNonce,
  } = useSessionSelectionStore(useShallow((state) => ({
    selectedWorkspaceId: state.selectedWorkspaceId,
    workspaceSelectionNonce: state.workspaceSelectionNonce,
  })));
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const {
    collapsedRepoGroups,
    setCollapsedRepoGroups,
  } = useWorkspaceUiStore(useShallow((state) => ({
    collapsedRepoGroups: state.collapsedRepoGroups,
    setCollapsedRepoGroups: state.setCollapsedRepoGroups,
  })));
  const {
    repoGroupsShownMore,
    repoGroupsShowMoreClearedByCollapse,
    lastAutoShownMoreSelection,
    toggleRepoGroupShowMore,
    recordAutoRepoGroupShowMore,
    clearRepoGroupShowMore,
    clearRepoGroupsShowMore,
    clearRepoGroupShowMoreAfterCollapse,
    clearRepoGroupsShowMoreAfterCollapse,
    clearAutoShownMoreSelection,
  } = useWorkspaceSidebarShowMoreStore(useShallow((state) => ({
    repoGroupsShownMore: state.repoGroupsShownMore,
    repoGroupsShowMoreClearedByCollapse: state.repoGroupsShowMoreClearedByCollapse,
    lastAutoShownMoreSelection: state.lastAutoShownMoreSelection,
    toggleRepoGroupShowMore: state.toggleRepoGroupShowMore,
    recordAutoRepoGroupShowMore: state.recordAutoRepoGroupShowMore,
    clearRepoGroupShowMore: state.clearRepoGroupShowMore,
    clearRepoGroupsShowMore: state.clearRepoGroupsShowMore,
    clearRepoGroupShowMoreAfterCollapse: state.clearRepoGroupShowMoreAfterCollapse,
    clearRepoGroupsShowMoreAfterCollapse: state.clearRepoGroupsShowMoreAfterCollapse,
    clearAutoShownMoreSelection: state.clearAutoShownMoreSelection,
  })));

  const allRepoKeys = useMemo(
    () => groups.map((group) => group.sourceRoot),
    [groups],
  );
  const visibleRepoKeySet = useMemo(() => new Set(allRepoKeys), [allRepoKeys]);
  const collapsedRepoGroupKeys = useMemo(
    () => new Set(collapsedRepoGroups),
    [collapsedRepoGroups],
  );
  const repoGroupsShownMoreKeys = useMemo(
    () => new Set(repoGroupsShownMore),
    [repoGroupsShownMore],
  );
  const repoGroupsShowMoreClearedByCollapseKeys = useMemo(
    () => new Set(repoGroupsShowMoreClearedByCollapse),
    [repoGroupsShowMoreClearedByCollapse],
  );
  const allRepoGroupsCollapsed = allRepoKeys.length > 0
    && allRepoKeys.every((key) => collapsedRepoGroupKeys.has(key));

  const selectedLogicalWorkspace = useMemo(
    () => findLogicalWorkspace(logicalWorkspaces, selectedLogicalWorkspaceId),
    [logicalWorkspaces, selectedLogicalWorkspaceId],
  );
  const selectedWorkspaceBelongsToLogicalWorkspace = useMemo(() => {
    if (!selectedWorkspaceId || !selectedLogicalWorkspace) {
      return false;
    }
    return logicalWorkspaceRelatedIds(selectedLogicalWorkspace).includes(selectedWorkspaceId);
  }, [selectedLogicalWorkspace, selectedWorkspaceId]);

  const autoShowMoreRepoKey = useMemo(() => {
    if (!selectedWorkspaceBelongsToLogicalWorkspace) {
      return null;
    }
    return resolveAutoShowMoreRepoKey({
      groups,
      selectedLogicalWorkspaceId,
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
    });
  }, [groups, selectedLogicalWorkspaceId, selectedWorkspaceBelongsToLogicalWorkspace]);

  useEffect(() => {
    if (!selectedLogicalWorkspaceId || !selectedWorkspaceId || !autoShowMoreRepoKey) {
      return;
    }

    const autoRecordMatches =
      lastAutoShownMoreSelection?.logicalWorkspaceId === selectedLogicalWorkspaceId
      && lastAutoShownMoreSelection.selectedWorkspaceId === selectedWorkspaceId
      && lastAutoShownMoreSelection.repoKey === autoShowMoreRepoKey
      && lastAutoShownMoreSelection.workspaceSelectionNonce === workspaceSelectionNonce;
    const wasClearedByCollapse = repoGroupsShowMoreClearedByCollapseKeys.has(autoShowMoreRepoKey);
    const isRepoCollapsed = collapsedRepoGroupKeys.has(autoShowMoreRepoKey);
    if (autoRecordMatches && (!wasClearedByCollapse || isRepoCollapsed)) {
      return;
    }

    recordAutoRepoGroupShowMore({
      logicalWorkspaceId: selectedLogicalWorkspaceId,
      selectedWorkspaceId,
      repoKey: autoShowMoreRepoKey,
      workspaceSelectionNonce,
    });
  }, [
    autoShowMoreRepoKey,
    collapsedRepoGroupKeys,
    lastAutoShownMoreSelection,
    recordAutoRepoGroupShowMore,
    repoGroupsShowMoreClearedByCollapseKeys,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    workspaceSelectionNonce,
  ]);

  const missingStoredRepoKeys = useMemo(
    () => Array.from(new Set([
      ...repoGroupsShownMore,
      ...repoGroupsShowMoreClearedByCollapse,
    ])).filter((repoKey) => !visibleRepoKeySet.has(repoKey)),
    [repoGroupsShowMoreClearedByCollapse, repoGroupsShownMore, visibleRepoKeySet],
  );
  useEffect(() => {
    if (missingStoredRepoKeys.length === 0) {
      return;
    }
    clearRepoGroupsShowMore(missingStoredRepoKeys);
  }, [clearRepoGroupsShowMore, missingStoredRepoKeys]);

  useEffect(() => {
    if (
      lastAutoShownMoreSelection
      && !visibleRepoKeySet.has(lastAutoShownMoreSelection.repoKey)
    ) {
      clearAutoShownMoreSelection();
    }
  }, [clearAutoShownMoreSelection, lastAutoShownMoreSelection, visibleRepoKeySet]);

  const handleToggleRepoShowMore = useCallback((sourceRoot: string) => {
    toggleRepoGroupShowMore(sourceRoot);
  }, [toggleRepoGroupShowMore]);

  const handleToggleRepoCollapsed = useCallback((sourceRoot: string) => {
    if (collapsedRepoGroupKeys.has(sourceRoot)) {
      setCollapsedRepoGroups(collapsedRepoGroups.filter((key) => key !== sourceRoot));
      return;
    }

    setCollapsedRepoGroups([...collapsedRepoGroups, sourceRoot]);
    clearRepoGroupShowMoreAfterCollapse(sourceRoot);
  }, [
    clearRepoGroupShowMoreAfterCollapse,
    collapsedRepoGroupKeys,
    collapsedRepoGroups,
    setCollapsedRepoGroups,
  ]);

  const handleToggleAllRepoGroups = useCallback(() => {
    if (allRepoGroupsCollapsed) {
      setCollapsedRepoGroups([]);
      return;
    }

    setCollapsedRepoGroups(allRepoKeys);
    clearRepoGroupsShowMoreAfterCollapse(allRepoKeys);
  }, [
    allRepoGroupsCollapsed,
    allRepoKeys,
    clearRepoGroupsShowMoreAfterCollapse,
    setCollapsedRepoGroups,
  ]);

  return {
    allRepoKeys,
    allRepoGroupsCollapsed,
    collapsedRepoGroupKeys,
    repoGroupsShownMoreKeys,
    handleToggleRepoShowMore,
    handleToggleRepoCollapsed,
    handleToggleAllRepoGroups,
    clearRepoGroupShowMore,
  };
}
