import type { GitStatusSnapshot } from "@anyharness/sdk";
import type { Workspace } from "@anyharness/sdk";
import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type SidebarSessionActivityState,
} from "@proliferate/product-domain/sessions/activity";
import {
  buildSidebarGroupStates,
  resolveSidebarEmptyState,
} from "@/lib/domain/workspaces/sidebar/sidebar-groups";
import { logicalWorkspaceRelatedIds } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type {
  SidebarEmptyState,
  SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";
import {
  isDocumentVisibleAndFocused,
  useDocumentFocusVisibilityNonce,
} from "@/hooks/ui/document/use-document-focus-visibility";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceMetadataSync } from "@/hooks/workspaces/lifecycle/use-workspace-metadata-sync";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useWorkspaceSidebarActivityStatesWithErrorAttention } from "@/hooks/workspaces/derived/use-workspace-sidebar-activities";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useDeferredHomeLaunchStore } from "@/stores/home/deferred-home-launch-store";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import { useComputeTargetOptions } from "@/hooks/compute/derived/use-compute-target-options";

interface UseWorkspaceSidebarStateArgs {
  showArchived: boolean;
  repoConfigs?: readonly RepoConfigResponse[];
}

interface WorkspaceSidebarState {
  groups: SidebarGroupState[];
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  archivedCount: number;
  selectedWorkspaceId: string | null;
  selectedLogicalWorkspaceId: string | null;
  gitStatus: GitStatusSnapshot | undefined;
  emptyState: SidebarEmptyState;
  cleanupAttentionWorkspaces: Workspace[];
  isLoading: boolean;
}

const EMPTY_WORKSPACES: Workspace[] = [];

const EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION: Record<string, string> = {};

export function useWorkspaceSidebarState({
  repoConfigs = [],
  showArchived,
}: UseWorkspaceSidebarStateArgs): WorkspaceSidebarState {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const lastViewedSessionErrorAtBySession = useWorkspaceUiStore((state) =>
    state.lastViewedSessionErrorAtBySession
    ?? EMPTY_LAST_VIEWED_SESSION_ERROR_AT_BY_SESSION
  );
  const workspaceActivities = useWorkspaceSidebarActivityStatesWithErrorAttention(
    lastViewedSessionErrorAtBySession,
  );
  // SPINNER STALENESS FIX: the sidebar 'iterating' spinner can be pinned by
  // the server-side executionSummary, which lives in the cached workspace
  // collections and refreshes only on collections sync — after a turn ended,
  // nothing refetched it, so the spinner ran on stale 'running' data
  // indefinitely (measured via sidebar_activity.summary_override
  // diagnostics). Refetch the collections whenever any workspace's LIVE
  // activity transitions to idle, so the summary self-corrects within one
  // roundtrip.
  const queryClient = useQueryClient();
  const previousActivitiesRef = useRef<Record<string, SidebarSessionActivityState> | null>(null);
  useEffect(() => {
    const previous = previousActivitiesRef.current;
    previousActivitiesRef.current = workspaceActivities;
    if (!previous) {
      return;
    }
    const anyWentIdle = Object.entries(workspaceActivities).some(([id, activity]) => {
      const before = previous[id];
      return (activity === "idle" || activity === "closed")
        && before !== undefined
        && before !== "idle"
        && before !== "closed";
    });
    if (anyWentIdle) {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    }
  }, [queryClient, workspaceActivities]);
  const deferredLaunchesById = useDeferredHomeLaunchStore((state) => state.launches);
  const activeSessionTitle = useSessionDirectoryStore((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] : null;
    return entry
      ? entry.title?.trim() || entry.activity.transcriptTitle?.trim() || null
      : null;
  });

  const {
    archivedWorkspaceIds,
    hiddenRepoRootIds,
    lastViewedAt,
    sessionLastInteracted,
    sessionLastViewedAt,
    workspaceLastInteracted,
    workspaceTypes,
  } = useWorkspaceUiStore(useShallow((state) => ({
    archivedWorkspaceIds: state.archivedWorkspaceIds,
    hiddenRepoRootIds: state.hiddenRepoRootIds,
    lastViewedAt: state.lastViewedAt,
    sessionLastInteracted: state.sessionLastInteracted,
    sessionLastViewedAt: state.sessionLastViewedAt,
    workspaceLastInteracted: state.workspaceLastInteracted,
    workspaceTypes: state.workspaceTypes,
  })));

  const focusVisibilityNonce = useDocumentFocusVisibilityNonce();
  const windowFocused = useMemo(
    () => isDocumentVisibleAndFocused(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusVisibilityNonce],
  );
  const { logicalWorkspaces, isLoading: workspacesLoading } = useLogicalWorkspaces();
  const { data: workspaceCollections } = useWorkspaces();
  const cleanupAttentionWorkspaces =
    workspaceCollections?.cleanupAttentionWorkspaces ?? EMPTY_WORKSPACES;
  const { repoRoots } = useStandardRepoProjection();
  const { data: gitStatus } = useWorkspaceMetadataSync();
  const computeTargets = useComputeTargetOptions();

  const sessionWorkspaceIds = useSessionDirectoryStore(useShallow((state) => {
    const ids: Record<string, string | null> = {};
    for (const [sessionId, entry] of Object.entries(state.entriesById)) {
      ids[sessionId] = entry.workspaceId;
    }
    return ids;
  }));
  const archivedSet = useMemo(
    () => new Set(archivedWorkspaceIds),
    [archivedWorkspaceIds],
  );
  const hiddenRepoRootSet = useMemo(
    () => new Set(hiddenRepoRootIds),
    [hiddenRepoRootIds],
  );

  const archivedCount = useMemo(
    () => logicalWorkspaces.filter((entry) =>
      logicalWorkspaceRelatedIds(entry).some((id) => archivedSet.has(id))
    ).length,
    [archivedSet, logicalWorkspaces],
  );
  const pendingPromptCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const launch of Object.values(deferredLaunchesById)) {
      counts[launch.workspaceId] = (counts[launch.workspaceId] ?? 0) + 1;
    }
    return counts;
  }, [deferredLaunchesById]);

  const groups = useMemo(() => measureDebugComputation({
    category: "workspace_sidebar_state.derive",
    label: "groups",
    keys: [
      "repoRoots",
      "repoConfigs",
      "logicalWorkspaces",
      "workspaceTypes",
      "selection",
      "pendingWorkspaceEntry",
      "workspaceActivities",
      "gitStatus",
      "targetAppearance",
    ],
    count: (value) => value.length,
  }, () => buildSidebarGroupStates({
      repoRoots,
      repoConfigs,
      logicalWorkspaces,
      showArchived,
      workspaceTypes,
      archivedSet,
      hiddenRepoRootIds: hiddenRepoRootSet,
      selectedLogicalWorkspaceId,
      selectedWorkspaceId,
      pendingWorkspaceEntry,
      workspaceActivities,
      pendingPromptCounts,
      gitStatus,
      activeSessionTitle,
      lastViewedAt,
      workspaceLastInteracted,
      sessionWorkspaceIds,
      sessionLastInteracted,
      sessionLastViewedAt,
      targetAppearanceById: computeTargets.targetAppearanceById,
      suppressActiveNeedsReview: windowFocused,
    })), [
    activeSessionTitle,
    archivedSet,
    computeTargets.targetAppearanceById,
    gitStatus,
    hiddenRepoRootSet,
    lastViewedAt,
    logicalWorkspaces,
    pendingWorkspaceEntry,
    pendingPromptCounts,
    repoConfigs,
    repoRoots,
    workspaceTypes,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    sessionLastInteracted,
    sessionLastViewedAt,
    sessionWorkspaceIds,
    showArchived,
    windowFocused,
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
    emptyState,
    cleanupAttentionWorkspaces,
    isLoading: workspacesLoading,
  };
}
