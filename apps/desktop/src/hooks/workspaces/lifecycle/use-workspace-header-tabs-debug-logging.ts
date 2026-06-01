import { useEffect } from "react";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";

export function useWorkspaceHeaderTabsDebugLogging({
  activationRenderSurface,
  activeSessionId,
  activeSessionWorkspaceId,
  activeShellTabKey,
  closedChatTabsCount,
  displayShellRowsCount,
  knownSessionIds,
  liveSlots,
  materializedWorkspaceId,
  orderedShellTabKeys,
  pendingWorkspaceEntry,
  pendingWorkspaceUiKey,
  resolvedSessionWorkspaceId,
  selectedLogicalWorkspaceId,
  selectedWorkspaceId,
  sessionWorkspaceId,
  stripVisibleChatSessionIds,
  visibleChatSessionIds,
  workspaceSessionsLoaded,
  workspaceUiKey,
}: {
  activationRenderSurface: WorkspaceRenderSurface;
  activeSessionId: string | null;
  activeSessionWorkspaceId: string | null;
  activeShellTabKey: string | null;
  closedChatTabsCount: number;
  displayShellRowsCount: number;
  knownSessionIds: readonly string[];
  liveSlots: readonly { sessionId: string }[];
  materializedWorkspaceId: string | null;
  orderedShellTabKeys: readonly string[];
  pendingWorkspaceEntry: PendingWorkspaceEntry | null;
  pendingWorkspaceUiKey: string | null;
  resolvedSessionWorkspaceId: string | null;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  sessionWorkspaceId: string | null;
  stripVisibleChatSessionIds: readonly string[];
  visibleChatSessionIds: readonly string[];
  workspaceSessionsLoaded: boolean;
  workspaceUiKey: string | null;
}) {
  useEffect(() => {
    if (!pendingWorkspaceEntry) {
      return;
    }
    logLatency("workspace.pending_shell.header_tabs_state", {
      attemptId: pendingWorkspaceEntry.attemptId,
      selectedWorkspaceId,
      selectedLogicalWorkspaceId,
      workspaceUiKey,
      materializedWorkspaceId,
      sessionWorkspaceId,
      resolvedSessionWorkspaceId,
      pendingWorkspaceUiKey,
      activeSessionWorkspaceId,
      activeSessionId,
      liveSlotIds: liveSlots.map((slot) => slot.sessionId),
      knownSessionIds,
      visibleChatSessionIds,
      stripVisibleChatSessionIds,
      orderedShellTabKeys,
      activeShellTabKey,
      shellRowsCount: displayShellRowsCount,
      closedChatTabsCount,
      workspaceSessionsLoaded,
      activationRenderSurface,
      storedActiveShellTabKey:
        workspaceUiKey
          ? useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace[workspaceUiKey] ?? null
          : null,
      storedShellTabOrder:
        workspaceUiKey
          ? useWorkspaceUiStore.getState().shellTabOrderByWorkspace[workspaceUiKey] ?? []
          : [],
    });
  }, [
    activationRenderSurface,
    activeSessionId,
    activeShellTabKey,
    activeSessionWorkspaceId,
    closedChatTabsCount,
    displayShellRowsCount,
    knownSessionIds,
    liveSlots,
    materializedWorkspaceId,
    orderedShellTabKeys,
    pendingWorkspaceEntry,
    pendingWorkspaceUiKey,
    resolvedSessionWorkspaceId,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    sessionWorkspaceId,
    stripVisibleChatSessionIds,
    visibleChatSessionIds,
    workspaceSessionsLoaded,
    workspaceUiKey,
  ]);
}
