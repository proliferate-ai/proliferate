import { useMemo } from "react";
import {
  buildHeaderLiveVisibilityCandidates,
  collectHierarchyChildren,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import { buildGroupedChatTabs } from "@/lib/domain/workspaces/tabs/grouping";
import {
  buildManualGroupByTopLevelSessionId,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-derivation";
import {
  deriveManualChatGroupsForDisplay,
  type DisplayManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  includeVisibleLinkedChildSessionIds,
  resolveVisibleChatSessionIds,
  type ChatVisibilityCandidate,
} from "@/lib/domain/workspaces/tabs/visibility";
import type { WorkspaceHeaderSubagentHierarchy } from "@/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import { useStableStringArray } from "@/hooks/workspaces/facade/tabs/use-stable-string-array";

export function useWorkspaceHeaderTabsVisibility({
  activeSessionId,
  hierarchy,
  knownSessionIds,
  persistedManualGroups,
  persistedVisibleIds,
  recentlyHiddenIds,
  workspaceSessionsLoaded,
}: {
  activeSessionId: string | null;
  hierarchy: WorkspaceHeaderSubagentHierarchy;
  knownSessionIds: readonly string[];
  persistedManualGroups: readonly DisplayManualChatGroup[];
  persistedVisibleIds: readonly string[] | undefined;
  recentlyHiddenIds: readonly string[];
  workspaceSessionsLoaded: boolean;
}) {
  const hierarchyChildren = useMemo(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "hierarchy_children",
      keys: ["hierarchy.childrenByParentSessionId"],
      count: (children) => children.visibilityCandidates.length,
    }, () => collectHierarchyChildren(hierarchy.childrenByParentSessionId)),
    [hierarchy.childrenByParentSessionId],
  );

  const liveVisibilityCandidates = useMemo<ChatVisibilityCandidate[]>(
    () => measureDebugComputation({
      category: "header_tabs.derive",
      label: "live_visibility_candidates",
      keys: ["knownSessionIds", "hierarchy.childToParent", "hierarchyChildren.visibilityCandidates"],
      count: (candidates) => candidates.length,
    }, () => buildHeaderLiveVisibilityCandidates({
      knownSessionIds,
      childToParent: hierarchy.childToParent,
      hierarchyVisibilityCandidates: hierarchyChildren.visibilityCandidates,
    })),
    [hierarchy.childToParent, hierarchyChildren.visibilityCandidates, knownSessionIds],
  );
  const liveChatSessionIds = useStableStringArray(useMemo(
    () => liveVisibilityCandidates.map((candidate) => candidate.sessionId),
    [liveVisibilityCandidates],
  ));
  const persistedVisibleIdsForResolution = useMemo(
    () => persistedVisibleIds?.filter((sessionId) =>
      sessionId === activeSessionId || !hierarchyChildren.rowsBySessionId.has(sessionId)
    ),
    [activeSessionId, hierarchyChildren.rowsBySessionId, persistedVisibleIds],
  );

  const visibleResolution = useMemo(
    () => resolveVisibleChatSessionIds({
      includeUnresolvedPersistedIds: !workspaceSessionsLoaded,
      liveSessions: liveVisibilityCandidates,
      persistedVisibleIds: persistedVisibleIdsForResolution,
      recentlyHiddenIds: [...recentlyHiddenIds],
      activeSessionId,
    }),
    [
      activeSessionId,
      liveVisibilityCandidates,
      persistedVisibleIdsForResolution,
      recentlyHiddenIds,
      workspaceSessionsLoaded,
    ],
  );
  const visibleChatSessionIds = useStableStringArray(visibleResolution.visibleSessionIds);
  const stripVisibleChatSessionIds = useStableStringArray(useMemo(
    () => includeVisibleLinkedChildSessionIds({
      visibleSessionIds: visibleResolution.visibleSessionIds,
      linkedChildrenByParentSessionId: hierarchyChildren.childIdsByParentSessionId,
      recentlyHiddenIds,
    }),
    [
      hierarchyChildren.childIdsByParentSessionId,
      recentlyHiddenIds,
      visibleResolution.visibleSessionIds,
    ],
  ));
  const groupedTabs = useMemo(
    () => buildGroupedChatTabs({
      visibleSessionIds: stripVisibleChatSessionIds,
      childToParent: hierarchy.childToParent,
    }),
    [hierarchy.childToParent, stripVisibleChatSessionIds],
  );
  const displayManualGroups = useMemo(
    () => deriveManualChatGroupsForDisplay({
      groups: persistedManualGroups,
      visibleSessionIds: stripVisibleChatSessionIds,
      childToParent: hierarchy.childToParent,
      resolvedHierarchySessionIds: hierarchy.resolvedSessionIds,
    }),
    [
      hierarchy.childToParent,
      hierarchy.resolvedSessionIds,
      persistedManualGroups,
      stripVisibleChatSessionIds,
    ],
  );
  const manualGroupByTopLevelSessionId = useMemo(() => {
    return buildManualGroupByTopLevelSessionId(displayManualGroups);
  }, [displayManualGroups]);

  return {
    displayManualGroups,
    groupedTabs,
    hierarchyChildren,
    liveChatSessionIds,
    manualGroupByTopLevelSessionId,
    prunedRecentlyHiddenIds: visibleResolution.prunedRecentlyHiddenIds,
    stripVisibleChatSessionIds,
    visibleChatSessionIds,
  };
}
