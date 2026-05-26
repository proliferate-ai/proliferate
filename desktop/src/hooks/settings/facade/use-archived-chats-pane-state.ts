import { useCallback, useMemo } from "react";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { logicalWorkspaceRelatedIds } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { sidebarWorkspaceVariantForLogicalWorkspace } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

export type ArchivedChatCleanupTone = "muted" | "working" | "attention";

export interface ArchivedChatRowView {
  id: string;
  title: string;
  metadata: string;
  locationLabel: string;
  cleanupLabel: string;
  cleanupTone: ArchivedChatCleanupTone;
  unarchiveDisabled: boolean;
}

export function useArchivedChatsPaneState() {
  const { logicalWorkspaces, isLoading } = useLogicalWorkspaces();
  const workspaceCollections = useWorkspaces();
  const archivedWorkspaceIds = useWorkspaceUiStore((state) => state.archivedWorkspaceIds);
  const unarchiveWorkspaces = useWorkspaceUiStore((state) => state.unarchiveWorkspaces);
  const { restoreCloudWorkspace, isRestoringCloudWorkspace } = useCloudWorkspaceActions();
  const showToast = useToastStore((state) => state.show);

  const archivedSet = useMemo(
    () => new Set(archivedWorkspaceIds),
    [archivedWorkspaceIds],
  );
  const archivedLogicalWorkspaces = useMemo(
    () => logicalWorkspaces.filter((workspace) => logicalWorkspaceIsArchived(workspace, archivedSet)),
    [archivedSet, logicalWorkspaces],
  );
  const workspaceById = useMemo(
    () => new Map(archivedLogicalWorkspaces.map((workspace) => [workspace.id, workspace])),
    [archivedLogicalWorkspaces],
  );
  const rows = useMemo(
    () => archivedLogicalWorkspaces.map((workspace) =>
      archivedChatRowView(workspace, isRestoringCloudWorkspace)),
    [archivedLogicalWorkspaces, isRestoringCloudWorkspace],
  );

  const unarchiveChat = useCallback((workspaceId: string) => {
    const workspace = workspaceById.get(workspaceId);
    if (!workspace) {
      return;
    }
    const relatedIds = logicalWorkspaceRelatedIds(workspace);
    const cloudWorkspace = workspace.cloudWorkspace;
    if (cloudWorkspace?.productLifecycle === "archived") {
      void restoreCloudWorkspace(cloudWorkspace.id)
        .then(() => {
          unarchiveWorkspaces(relatedIds);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Failed to unarchive chat.";
          showToast(message);
        });
      return;
    }

    unarchiveWorkspaces(relatedIds);
  }, [
    restoreCloudWorkspace,
    showToast,
    unarchiveWorkspaces,
    workspaceById,
  ]);

  return {
    rows,
    isLoading: isLoading && !workspaceCollections.data,
    isRefreshing: workspaceCollections.isFetching,
    error: workspaceCollections.error,
    backgroundRefreshFailed: Boolean(workspaceCollections.error) && Boolean(workspaceCollections.data),
    refetch: workspaceCollections.refetch,
    unarchiveChat,
  };
}

function logicalWorkspaceIsArchived(
  workspace: LogicalWorkspace,
  archivedSet: ReadonlySet<string>,
): boolean {
  return workspace.cloudWorkspace?.productLifecycle === "archived"
    || logicalWorkspaceRelatedIds(workspace).some((id) => archivedSet.has(id));
}

function archivedChatRowView(
  workspace: LogicalWorkspace,
  unarchiveDisabled: boolean,
): ArchivedChatRowView {
  const materialization = workspace.cloudWorkspace?.primaryMaterialization ?? null;
  const cleanupStatus = materialization?.cleanupStatus ?? "idle";
  const cleanupLabel = cleanupStatusLabel(cleanupStatus, materialization?.cleanupLastError);
  return {
    id: workspace.id,
    title: workspace.displayName,
    metadata: archivedChatMetadata(workspace),
    locationLabel: locationLabelForWorkspace(workspace),
    cleanupLabel,
    cleanupTone: cleanupTone(cleanupStatus),
    unarchiveDisabled,
  };
}

function archivedChatMetadata(workspace: LogicalWorkspace): string {
  return [
    formatArchivedTimestamp(workspace.updatedAt),
    workspace.repoName,
    workspace.branchKey,
  ].filter(Boolean).join(" · ");
}

function formatArchivedTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function locationLabelForWorkspace(workspace: LogicalWorkspace): string {
  const variant = sidebarWorkspaceVariantForLogicalWorkspace(workspace);
  switch (variant) {
    case "worktree":
      return "Worktree";
    case "cloud":
      return "Cloud";
    case "ssh":
      return "SSH";
    case "local":
      return "Local";
  }
}

function cleanupStatusLabel(status: string, lastError: string | null | undefined): string {
  if (status === "blocked") {
    return lastError ? `Cleanup blocked: ${lastError}` : "Cleanup blocked";
  }
  if (status === "failed") {
    return lastError ? `Cleanup failed: ${lastError}` : "Cleanup failed";
  }
  if (status === "pruning") {
    return "Cleaning up worktree";
  }
  if (status === "completed") {
    return "Worktree cleaned up";
  }
  if (status === "skipped") {
    return "Cleanup skipped";
  }
  return "Archived";
}

function cleanupTone(status: string): ArchivedChatCleanupTone {
  if (status === "blocked" || status === "failed") {
    return "attention";
  }
  if (status === "pruning") {
    return "working";
  }
  return "muted";
}
