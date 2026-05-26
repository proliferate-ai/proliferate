import { useCallback, useMemo, useState } from "react";
import {
  buildWorkspaceInventoryFilterOptions,
  filterWorkspaceInventoryItems,
  groupWorkspaceInventoryItems,
  workspaceInventorySummaryLabel,
  workspaceInventorySyncLabel,
  WORKSPACE_INVENTORY_GROUP_OPTIONS,
  type WorkspaceInventoryFilterId,
  type WorkspaceInventoryGroupBy,
  type WorkspaceInventoryItemView,
  type WorkspaceInventoryLocationKind,
} from "@proliferate/product-model/workspaces/inventory";
import { WorkspacesSurface } from "@proliferate/product-ui/workspaces/WorkspacesSurface";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import {
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  sidebarWorkspaceVariantForLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function ArchivedWorkspacesPage() {
  const { logicalWorkspaces, isLoading } = useLogicalWorkspaces();
  const workspaceCollections = useWorkspaces();
  const archivedWorkspaceIds = useWorkspaceUiStore((state) => state.archivedWorkspaceIds);
  const unarchiveWorkspace = useWorkspaceUiStore((state) => state.unarchiveWorkspace);
  const { restoreCloudWorkspace } = useCloudWorkspaceActions();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();
  const showToast = useToastStore((state) => state.show);
  const [filterId, setFilterId] = useState<WorkspaceInventoryFilterId>("all");
  const [groupBy, setGroupBy] = useState<WorkspaceInventoryGroupBy>("source");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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
  const allItems = useMemo(
    () => archivedLogicalWorkspaces.map(archivedWorkspaceInventoryItem),
    [archivedLogicalWorkspaces],
  );
  const filterOptions = useMemo(
    () => buildWorkspaceInventoryFilterOptions(allItems),
    [allItems],
  );
  const filteredItems = useMemo(
    () => filterWorkspaceInventoryItems(allItems, filterId),
    [allItems, filterId],
  );
  const groups = useMemo(
    () => groupWorkspaceInventoryItems(filteredItems, groupBy, collapsedGroupIds),
    [collapsedGroupIds, filteredItems, groupBy],
  );
  const summaryLabel = useMemo(
    () => workspaceInventorySummaryLabel(allItems),
    [allItems],
  );

  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    const workspace = workspaceById.get(workspaceId);
    if (!workspace) {
      return;
    }

    void (async () => {
      try {
        if (workspace.cloudWorkspace) {
          const restored = await restoreCloudWorkspace(workspace.cloudWorkspace.id);
          selectWorkspaceFromSurface(cloudWorkspaceSyntheticId(restored.id), "archived_workspaces");
          return;
        }
        unarchiveWorkspace(workspace.id);
        selectWorkspaceFromSurface(workspace.id, "archived_workspaces");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to restore workspace.";
        showToast(message);
      }
    })();
  }, [
    restoreCloudWorkspace,
    selectWorkspaceFromSurface,
    showToast,
    unarchiveWorkspace,
    workspaceById,
  ]);

  return (
    <MainSidebarPageShell>
      <WorkspacesSurface
        title="Archived chats"
        groups={groups}
        filterOptions={filterOptions}
        selectedFilterId={filterId}
        groupOptions={WORKSPACE_INVENTORY_GROUP_OPTIONS}
        selectedGroupId={groupBy}
        summaryLabel={summaryLabel}
        lastSyncedLabel={workspaceInventorySyncLabel(workspaceCollections.dataUpdatedAt)}
        loading={isLoading && !workspaceCollections.data}
        error={Boolean(workspaceCollections.error) && !workspaceCollections.data}
        backgroundRefreshFailed={Boolean(workspaceCollections.error) && Boolean(workspaceCollections.data)}
        isRefreshing={workspaceCollections.isFetching}
        emptyTitle={filterId === "all" ? "No archived chats" : "No matching archived chats"}
        emptyDescription={
          filterId === "all"
            ? "Archive a chat from the sidebar to move it here."
            : "Try a different filter."
        }
        onFilterChange={(nextFilterId) => {
          setFilterId(nextFilterId);
          setCollapsedGroupIds(new Set());
        }}
        onGroupChange={(nextGroupBy) => {
          setGroupBy(nextGroupBy);
          setCollapsedGroupIds(new Set());
        }}
        onRefresh={() => void workspaceCollections.refetch()}
        onGroupToggle={(groupId) => {
          setCollapsedGroupIds((current) => {
            const next = new Set(current);
            if (next.has(groupId)) {
              next.delete(groupId);
            } else {
              next.add(groupId);
            }
            return next;
          });
        }}
        onWorkspaceSelect={handleWorkspaceSelect}
      />
    </MainSidebarPageShell>
  );
}

function logicalWorkspaceIsArchived(
  workspace: LogicalWorkspace,
  archivedSet: ReadonlySet<string>,
): boolean {
  return workspace.cloudWorkspace?.productLifecycle === "archived"
    || logicalWorkspaceRelatedIds(workspace).some((id) => archivedSet.has(id));
}

function archivedWorkspaceInventoryItem(workspace: LogicalWorkspace): WorkspaceInventoryItemView {
  const variant = sidebarWorkspaceVariantForLogicalWorkspace(workspace);
  return {
    id: workspace.id,
    title: workspace.displayName,
    repoLabel: workspace.repoName,
    branchLabel: workspace.branchKey,
    sourceKind: "chat",
    sourceLabel: workspace.cloudWorkspace ? "Cloud" : "Desktop",
    locationKind: archivedLocationKind(variant),
    locationLabel: archivedLocationLabel(variant),
    scopeLabel: workspace.cloudWorkspace ? "Cloud" : "Local",
    statusKind: "done",
    statusLabel: "Archived",
    ownershipKind: "archived",
    ownerLabel: "Archived",
    exposureLabel: workspace.cloudWorkspace?.exposureState ?? null,
    sessionLabel: null,
    updatedLabel: null,
    active: false,
  };
}

function archivedLocationKind(
  variant: ReturnType<typeof sidebarWorkspaceVariantForLogicalWorkspace>,
): WorkspaceInventoryLocationKind {
  switch (variant) {
    case "worktree":
      return "worktree";
    case "cloud":
      return "cloud";
    case "ssh":
      return "ssh";
    case "local":
      return "local";
  }
}

function archivedLocationLabel(
  variant: ReturnType<typeof sidebarWorkspaceVariantForLogicalWorkspace>,
): string {
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
