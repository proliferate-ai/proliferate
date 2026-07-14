import { useEffect, useMemo } from "react";
import { resolveSessionSidebarActivityState } from "@proliferate/product-domain/sessions/activity";
import type { DesktopNativeUiBridge } from "@proliferate/product-client/host/desktop-bridge";
import { useShallow } from "zustand/react/shallow";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useWorkspaceSidebarActivityStatesWithErrorAttention } from "@/hooks/workspaces/derived/use-workspace-sidebar-activities";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import {
  buildWorkspaceActivityIndicatorSnapshot,
} from "@/lib/domain/workspaces/sidebar/workspace-activity-indicator";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION: Record<string, string> = {};
let lastWorkspaceActivityIndicatorPayloadSignature: string | null = null;
let pendingWorkspaceActivityIndicatorPayloadSignature: string | null = null;

export function resetWorkspaceActivityIndicatorExportForTests(): void {
  lastWorkspaceActivityIndicatorPayloadSignature = null;
  pendingWorkspaceActivityIndicatorPayloadSignature = null;
}

export function useWorkspaceActivityIndicator(
  setWorkspaceActivity: DesktopNativeUiBridge["setWorkspaceActivity"],
): void {
  const {
    logicalWorkspaces,
    isLoading: logicalWorkspacesLoading,
  } = useLogicalWorkspaces();
  const {
    archivedWorkspaceIds,
    hiddenRepoRootIds,
    hydrated: workspaceUiHydrated,
    lastViewedAt,
    lastViewedSessionErrorAtBySession,
    sessionLastInteracted,
    sessionLastViewedAt,
    workspaceLastInteracted,
    workspaceTypes,
  } = useWorkspaceUiStore(useShallow((state) => ({
    archivedWorkspaceIds: state.archivedWorkspaceIds,
    hiddenRepoRootIds: state.hiddenRepoRootIds,
    hydrated: state._hydrated,
    lastViewedAt: state.lastViewedAt,
    lastViewedSessionErrorAtBySession:
      state.lastViewedSessionErrorAtBySession
      ?? EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION,
    sessionLastInteracted: state.sessionLastInteracted,
    sessionLastViewedAt: state.sessionLastViewedAt,
    workspaceLastInteracted: state.workspaceLastInteracted,
    workspaceTypes: state.workspaceTypes,
  })));
  const {
    hydrated: sessionSelectionHydrated,
    selectedLogicalWorkspaceId,
  } = useSessionSelectionStore(useShallow((state) => ({
    hydrated: state._hydrated,
    selectedLogicalWorkspaceId: state.selectedLogicalWorkspaceId,
  })));
  const workspaceActivities = useWorkspaceSidebarActivityStatesWithErrorAttention(
    lastViewedSessionErrorAtBySession,
  );
  const sessionEntriesById = useSessionDirectoryStore((state) => state.entriesById);
  const deferredLaunchesById = useDeferredHomeLaunchStore((state) => state.launches);

  const archivedSet = useMemo(
    () => new Set(archivedWorkspaceIds),
    [archivedWorkspaceIds],
  );
  const hiddenRepoRootSet = useMemo(
    () => new Set(hiddenRepoRootIds),
    [hiddenRepoRootIds],
  );
  const pendingPromptCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const launch of Object.values(deferredLaunchesById)) {
      counts[launch.workspaceId] = (counts[launch.workspaceId] ?? 0) + 1;
    }
    return counts;
  }, [deferredLaunchesById]);
  const sessionActivityInputs = useMemo(() => {
    const sessionWorkspaceIds: Record<string, string | null> = {};
    const sessionActivities: Record<string, ReturnType<typeof resolveSessionSidebarActivityState>> = {};
    for (const entry of Object.values(sessionEntriesById)) {
      sessionWorkspaceIds[entry.sessionId] = entry.workspaceId;
      const activity = resolveSessionSidebarActivityState(
        activitySnapshotFromDirectoryEntry(entry),
      );
      sessionActivities[entry.sessionId] =
        activity === "error"
          && entry.activity.errorAttentionKey !== null
          && lastViewedSessionErrorAtBySession[entry.sessionId] === entry.activity.errorAttentionKey
          ? "idle"
          : activity;
    }
    return { sessionActivities, sessionWorkspaceIds };
  }, [lastViewedSessionErrorAtBySession, sessionEntriesById]);

  const snapshot = useMemo(() => buildWorkspaceActivityIndicatorSnapshot({
    logicalWorkspaces,
    workspaceActivities,
    pendingPromptCounts,
    archivedSet,
    hiddenRepoRootIds: hiddenRepoRootSet,
    selectedLogicalWorkspaceId,
    workspaceTypes,
    lastViewedAt,
    workspaceLastInteracted,
    sessionWorkspaceIds: sessionActivityInputs.sessionWorkspaceIds,
    sessionActivities: sessionActivityInputs.sessionActivities,
    sessionLastInteracted,
    sessionLastViewedAt,
  }), [
    archivedSet,
    hiddenRepoRootSet,
    lastViewedAt,
    logicalWorkspaces,
    pendingPromptCounts,
    selectedLogicalWorkspaceId,
    sessionActivityInputs.sessionActivities,
    sessionActivityInputs.sessionWorkspaceIds,
    sessionLastInteracted,
    sessionLastViewedAt,
    workspaceActivities,
    workspaceLastInteracted,
    workspaceTypes,
  ]);

  useEffect(() => {
    if (!workspaceUiHydrated || !sessionSelectionHydrated || logicalWorkspacesLoading) {
      return;
    }

    const signature = `${snapshot.state}\u001f${snapshot.attentionCount}`;
    if (
      lastWorkspaceActivityIndicatorPayloadSignature === signature
      || pendingWorkspaceActivityIndicatorPayloadSignature === signature
    ) {
      return;
    }

    pendingWorkspaceActivityIndicatorPayloadSignature = signature;
    const payload = {
      state: snapshot.state,
      attentionCount: snapshot.attentionCount,
    };
    void setWorkspaceActivity(payload)
      .then(() => {
        if (pendingWorkspaceActivityIndicatorPayloadSignature === signature) {
          lastWorkspaceActivityIndicatorPayloadSignature = signature;
          pendingWorkspaceActivityIndicatorPayloadSignature = null;
        }
      })
      .catch(() => {
        if (pendingWorkspaceActivityIndicatorPayloadSignature === signature) {
          pendingWorkspaceActivityIndicatorPayloadSignature = null;
        }
      });
  }, [
    setWorkspaceActivity,
    logicalWorkspacesLoading,
    snapshot.attentionCount,
    snapshot.state,
    sessionSelectionHydrated,
    workspaceUiHydrated,
  ]);
}
