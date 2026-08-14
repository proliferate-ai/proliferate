import { useMemo } from "react";
import type { Session } from "@anyharness/sdk";
import type { SessionDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-entry";
import { useWorkspaceHeaderSubagentHierarchy } from "#product/hooks/workspaces/cache/tabs/use-workspace-header-subagent-hierarchy";
import type { WorkspaceHeaderSubagentHierarchy } from "#product/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";
import {
  buildKnownHeaderSessions,
  type KnownHeaderSession,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import { measureDebugComputation } from "#product/lib/infra/measurement/measurement-port";
import { useStableStringArray } from "#product/hooks/workspaces/facade/tabs/use-stable-string-array";
import {
  filterReplacedSessionIds,
  filterReplacedSessionTombstones,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";

/**
 * The known-session map plus the subagent hierarchy derived from it, and the
 * header-only view of both with pane-only subagents filtered out. Split from
 * `use-workspace-header-tabs-view-model.ts` along the known-sessions/hierarchy
 * derivation seam to keep that facade under the documented frontend file
 * threshold.
 */
export function useWorkspaceHeaderTabsKnownSessions({
  clientSessionIdByMaterializedSessionId,
  hierarchyPrioritySessionIds,
  liveSlots,
  optimisticHeaderSessionIds,
  selectedWorkspaceId,
  workspaceSessionsData,
}: {
  clientSessionIdByMaterializedSessionId: Readonly<Record<string, string | undefined>>;
  hierarchyPrioritySessionIds: string[];
  liveSlots: readonly SessionDirectoryEntry[];
  optimisticHeaderSessionIds: string[];
  selectedWorkspaceId: string | null;
  workspaceSessionsData: readonly Session[] | undefined;
}): {
  knownSessions: Map<string, KnownHeaderSession>;
  hierarchy: WorkspaceHeaderSubagentHierarchy;
  headerHierarchy: WorkspaceHeaderSubagentHierarchy;
  headerKnownSessionIds: string[];
  paneOnlySubagentSessionIds: ReadonlySet<string>;
} {
  const knownSessions = useMemo<Map<string, KnownHeaderSession>>(() =>
    measureDebugComputation({
      category: "header_tabs.derive",
      label: "known_sessions",
      keys: [
        "liveSlots",
        "optimisticHeaderSessionIds",
        "workspaceSessionsQuery.data",
        "selectedWorkspaceId",
      ],
      count: (map) => map.size,
    }, () => {
      // Resolve tombstones inside the live-slot memo. Beginning a replacement
      // removes the old slot while intentionally leaving the runtime query
      // cache untouched for rollback; the liveSlots dependency is therefore
      // the render signal that hides the retired cached header row immediately.
      const visibleWorkspaceSessions = selectedWorkspaceId
        ? filterReplacedSessionTombstones(
          selectedWorkspaceId,
          workspaceSessionsData,
        )
        : workspaceSessionsData;
      const visibleOptimisticSessionIds = selectedWorkspaceId
        ? filterReplacedSessionIds(selectedWorkspaceId, optimisticHeaderSessionIds)
        : optimisticHeaderSessionIds;
      return buildKnownHeaderSessions({
        optimisticSessionIds: visibleOptimisticSessionIds,
        sessions: visibleWorkspaceSessions,
        selectedWorkspaceId,
        clientSessionIdByMaterializedSessionId,
        liveSlots,
      });
    }), [
      clientSessionIdByMaterializedSessionId,
      liveSlots,
      optimisticHeaderSessionIds,
      selectedWorkspaceId,
      workspaceSessionsData,
    ]);
  const knownSessionIds = useStableStringArray(
    useMemo(() => Array.from(knownSessions.keys()), [knownSessions]),
  );
  const hierarchy = useWorkspaceHeaderSubagentHierarchy({
    prioritySessionIds: hierarchyPrioritySessionIds,
    workspaceId: selectedWorkspaceId,
    sessionIds: knownSessionIds,
  });
  const paneOnlySubagentSessionIds = useMemo(() => {
    const sessionIds = new Set(hierarchy.paneOnlySubagentSessionIds);
    for (const slot of liveSlots) {
      if (slot.sessionRelationship.kind === "subagent_child") {
        sessionIds.add(slot.sessionId);
      }
    }
    return sessionIds;
  }, [hierarchy.paneOnlySubagentSessionIds, liveSlots]);
  const headerHierarchy = useMemo(() => ({
    ...hierarchy,
    paneOnlySubagentSessionIds,
  }), [hierarchy, paneOnlySubagentSessionIds]);
  const headerKnownSessionIds = useStableStringArray(useMemo(
    () => knownSessionIds.filter((sessionId) => !paneOnlySubagentSessionIds.has(sessionId)),
    [knownSessionIds, paneOnlySubagentSessionIds],
  ));

  return {
    knownSessions,
    hierarchy,
    headerHierarchy,
    headerKnownSessionIds,
    paneOnlySubagentSessionIds,
  };
}
