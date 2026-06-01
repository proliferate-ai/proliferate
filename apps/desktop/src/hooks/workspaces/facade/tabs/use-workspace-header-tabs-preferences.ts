import { useMemo } from "react";
import {
  resolveWithWorkspaceFallback,
} from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import {
  type DisplayManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";
import { uniqueIds } from "@/lib/domain/workspaces/tabs/visibility";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useStableStringArray } from "@/hooks/workspaces/facade/tabs/use-stable-string-array";

const EMPTY_SESSION_ID_LIST: string[] = [];
const EMPTY_MANUAL_GROUPS: DisplayManualChatGroup[] = [];

export function useWorkspaceHeaderTabsPreferences({
  activeSessionId,
  materializedWorkspaceId,
  workspaceSessionsLoaded,
  workspaceUiKey,
}: {
  activeSessionId: string | null;
  materializedWorkspaceId: string | null;
  workspaceSessionsLoaded: boolean;
  workspaceUiKey: string | null;
}) {
  const visibleByWorkspace = useWorkspaceUiStore((s) => s.visibleChatSessionIdsByWorkspace);
  const hiddenByWorkspace = useWorkspaceUiStore((s) => s.recentlyHiddenChatSessionIdsByWorkspace);
  const collapsedGroupsByWorkspace = useWorkspaceUiStore((s) => s.collapsedChatGroupsByWorkspace);
  const manualGroupsByWorkspace = useWorkspaceUiStore((s) => s.manualChatGroupsByWorkspace);
  const sessionLastInteracted = useWorkspaceUiStore((s) => s.sessionLastInteracted);
  const sessionLastViewedAt = useWorkspaceUiStore((s) => s.sessionLastViewedAt);

  const persistedVisibleFallback = resolveWithWorkspaceFallback(
    visibleByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const recentlyHiddenFallback = resolveWithWorkspaceFallback(
    hiddenByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const collapsedParentFallback = resolveWithWorkspaceFallback(
    collapsedGroupsByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const manualGroupsFallback = resolveWithWorkspaceFallback(
    manualGroupsByWorkspace,
    workspaceUiKey,
    materializedWorkspaceId,
  );
  const persistedVisibleIds = persistedVisibleFallback.value;
  const recentlyHiddenIds = recentlyHiddenFallback.value ?? EMPTY_SESSION_ID_LIST;
  const collapsedParentIds = collapsedParentFallback.value ?? EMPTY_SESSION_ID_LIST;
  const persistedManualGroups = manualGroupsFallback.value ?? EMPTY_MANUAL_GROUPS;
  const optimisticHeaderSessionIds = useStableStringArray(useMemo(
    () => workspaceSessionsLoaded
      ? EMPTY_SESSION_ID_LIST
      : uniqueIds([
        ...(persistedVisibleIds ?? []),
        activeSessionId ?? "",
      ]).filter(Boolean),
    [
      activeSessionId,
      persistedVisibleIds,
      workspaceSessionsLoaded,
    ],
  ));
  const hierarchyPrioritySessionIds = useStableStringArray(useMemo(
    () => uniqueIds([
      activeSessionId ?? "",
      ...(persistedVisibleIds ?? []),
    ]).filter(Boolean),
    [activeSessionId, persistedVisibleIds],
  ));

  return {
    collapsedParentFallback,
    collapsedParentIds,
    hierarchyPrioritySessionIds,
    manualGroupsFallback,
    optimisticHeaderSessionIds,
    persistedManualGroups,
    persistedVisibleFallback,
    persistedVisibleIds,
    recentlyHiddenFallback,
    recentlyHiddenIds,
    sessionLastInteracted,
    sessionLastViewedAt,
  };
}
