import { useCallback, useMemo, useState } from "react";
import type { CloudWorkspaceLifecycleFilter, CloudWorkspaceSummary } from "@proliferate/cloud-sdk";
import { webWorkspaceDeepLink } from "@proliferate/cloud-sdk";
import {
  buildCloudWorkspaceInventoryItems,
  buildWorkspaceInventoryFilterOptions,
  filterWorkspaceInventoryItems,
  groupWorkspaceInventoryItems,
  workspaceInventorySummaryLabel,
  workspaceInventorySyncLabel,
  WORKSPACE_INVENTORY_GROUP_OPTIONS,
  type WorkspaceInventoryFilterId,
  type WorkspaceInventoryGroupBy,
} from "@proliferate/product-model/workspaces/inventory";
import { WorkspacesSurface } from "@proliferate/product-ui/workspaces/WorkspacesSurface";

import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useCloudExposedWorkspaces } from "@/hooks/access/cloud/workspaces/use-cloud-exposed-workspaces";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_WORKSPACES: readonly CloudWorkspaceSummary[] = [];

interface CloudWorkspacesScreenProps {
  lifecycle?: CloudWorkspaceLifecycleFilter;
  title?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function CloudWorkspacesScreen({
  lifecycle = "active",
  title = "Workspaces",
  emptyTitle,
  emptyDescription,
}: CloudWorkspacesScreenProps = {}) {
  const workspaces = useCloudExposedWorkspaces({ lifecycle });
  const { openExternal } = useTauriShellActions();
  const {
    refreshCloudWorkspace,
    restoreCloudWorkspace,
  } = useCloudWorkspaceActions();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();
  const showToast = useToastStore((state) => state.show);
  const [filterId, setFilterId] = useState<WorkspaceInventoryFilterId>("all");
  const [groupBy, setGroupBy] = useState<WorkspaceInventoryGroupBy>("source");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const workspaceItems = workspaces.data ?? EMPTY_WORKSPACES;
  const hasResolvedData = workspaces.data !== undefined;
  const backgroundRefreshFailed = Boolean(workspaces.error) && hasResolvedData;

  const allItems = useMemo(
    () => buildCloudWorkspaceInventoryItems(workspaceItems),
    [workspaceItems],
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
  const lastSyncedLabel = workspaceInventorySyncLabel(workspaces.dataUpdatedAt);
  const externalOpenWorkspaceIds = useMemo(
    () =>
      new Set(
        workspaceItems
          .filter((workspace) => workspace.visibility === "shared_unclaimed")
          .map((workspace) => workspace.id),
      ),
    [workspaceItems],
  );

  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    const workspaceItem = workspaceItems.find((candidate) => candidate.id === workspaceId);
    if (workspaceItem?.visibility === "shared_unclaimed") {
      const url = webWorkspaceDeepLink(workspaceId, getProliferateWebBaseUrl());
      void openExternal(url).catch(() => {
        showToast("Failed to open the web workspace.");
      });
      return;
    }

    void (async () => {
      try {
        const workspace = lifecycle === "archived"
          ? await restoreCloudWorkspace(workspaceId)
          : await refreshCloudWorkspace(workspaceId);
        selectWorkspaceFromSurface(
          cloudWorkspaceSyntheticId(workspace.id),
          "workspaces",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open workspace.";
        showToast(message);
      }
    })();
  }, [
    openExternal,
    refreshCloudWorkspace,
    restoreCloudWorkspace,
    lifecycle,
    selectWorkspaceFromSurface,
    showToast,
    workspaceItems,
  ]);

  return (
    <MainSidebarPageShell>
      <WorkspacesSurface
        title={title}
        groups={groups}
        filterOptions={filterOptions}
        selectedFilterId={filterId}
        groupOptions={WORKSPACE_INVENTORY_GROUP_OPTIONS}
        selectedGroupId={groupBy}
        summaryLabel={summaryLabel}
        lastSyncedLabel={lastSyncedLabel}
        loading={workspaces.isLoading && !hasResolvedData}
        error={Boolean(workspaces.error) && !hasResolvedData}
        backgroundRefreshFailed={backgroundRefreshFailed}
        isRefreshing={workspaces.isFetching}
        externalOpenWorkspaceIds={externalOpenWorkspaceIds}
        emptyTitle={
          filterId === "all"
            ? emptyTitle ?? "No cloud-visible workspaces"
            : "No matching workspaces"
        }
        emptyDescription={
          filterId === "all"
            ? emptyDescription ?? "Workspaces from Desktop, Web, Slack, or automations appear here."
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
        onRefresh={() => void workspaces.refetch()}
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
