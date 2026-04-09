import type { GitStatusSnapshot, Workspace } from "@anyharness/sdk";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  collectWorkspaceSessionViewStates,
  type SessionViewState,
} from "@/lib/domain/sessions/activity";
import {
  buildSidebarGroupStates,
  buildSidebarWorkspaceEntries,
  type SidebarGroupState,
} from "@/lib/domain/workspaces/sidebar";
import { getEffectiveSessionTitle } from "@/lib/domain/sessions/title";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useWorkspaceBranchRenameMonitor } from "@/hooks/workspaces/use-workspace-branch-rename-monitor";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const EMPTY_LOCAL_WORKSPACES: Workspace[] = [];
const EMPTY_CLOUD_WORKSPACES: CloudWorkspaceSummary[] = [];

interface UseWorkspaceSidebarStateArgs {
  showArchived: boolean;
}

interface WorkspaceSidebarState {
  groups: SidebarGroupState[];
  workspaceActivities: Record<string, SessionViewState>;
  archivedCount: number;
  selectedWorkspaceId: string | null;
  gitStatus: GitStatusSnapshot | undefined;
  transcriptTitle: string | null;
  isEmpty: boolean;
  isLoading: boolean;
}

export function useWorkspaceSidebarState({
  showArchived,
}: UseWorkspaceSidebarStateArgs): WorkspaceSidebarState {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const workspaceActivities = useHarnessStore(useShallow((state) =>
    collectWorkspaceSessionViewStates(state.sessionSlots)
  ));
  const activeSessionTitle = useHarnessStore((state) => {
    const sessionId = state.activeSessionId;
    const slot = sessionId ? state.sessionSlots[sessionId] : null;
    return slot ? getEffectiveSessionTitle(slot) : null;
  });

  const archivedWorkspaceIds = useWorkspaceUiStore((state) => state.archivedWorkspaceIds);
  const lastViewedAt = useWorkspaceUiStore((state) => state.lastViewedAt);
  const workspaceLastInteracted = useWorkspaceUiStore(
    (state) => state.workspaceLastInteracted,
  );

  const { data: workspaceCollections, isLoading: workspacesLoading } = useWorkspaces();
  const { data: gitStatus } = useWorkspaceBranchRenameMonitor();

  const localWorkspaces = workspaceCollections?.localWorkspaces ?? EMPTY_LOCAL_WORKSPACES;
  const cloudWorkspaces = workspaceCollections?.cloudWorkspaces ?? EMPTY_CLOUD_WORKSPACES;

  const archivedSet = useMemo(
    () => new Set(archivedWorkspaceIds),
    [archivedWorkspaceIds],
  );

  const sidebarEntries = useMemo(
    () => buildSidebarWorkspaceEntries(localWorkspaces, cloudWorkspaces),
    [cloudWorkspaces, localWorkspaces],
  );

  const archivedCount = useMemo(
    () => sidebarEntries.filter((entry) => archivedSet.has(entry.id)).length,
    [archivedSet, sidebarEntries],
  );

  const groups = useMemo(() => buildSidebarGroupStates({
    sidebarEntries,
    showArchived,
    archivedSet,
    selectedWorkspaceId,
    workspaceActivities,
    gitStatus,
    activeSessionTitle,
    lastViewedAt,
    workspaceLastInteracted,
  }), [
    activeSessionTitle,
    archivedSet,
    gitStatus,
    lastViewedAt,
    selectedWorkspaceId,
    showArchived,
    sidebarEntries,
    workspaceActivities,
    workspaceLastInteracted,
  ]);

  return {
    groups,
    workspaceActivities,
    archivedCount,
    selectedWorkspaceId,
    gitStatus,
    transcriptTitle: activeSessionTitle,
    isEmpty: groups.length === 0,
    isLoading: workspacesLoading || !workspaceCollections,
  };
}
