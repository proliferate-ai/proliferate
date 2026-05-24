import { useEffect, useMemo, useState } from "react";
import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";
import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";
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
import { useNavigate } from "react-router-dom";

import { routes } from "../../../config/routes";

const EMPTY_CLOUD_WORKSPACES: readonly CloudWorkspaceSummary[] = [];

export function WorkspacesScreen() {
  const workspaces = useCloudWorkspaces({ scope: "exposed" });
  const navigate = useNavigate();
  const [filterId, setFilterId] = useState<WorkspaceInventoryFilterId>("all");
  const [groupBy, setGroupBy] = useState<WorkspaceInventoryGroupBy>("source");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [syncLabelNow, setSyncLabelNow] = useState(() => Date.now());
  const workspaceItems = workspaces.data ?? EMPTY_CLOUD_WORKSPACES;
  const hasResolvedWorkspaceData = workspaces.data !== undefined;
  const backgroundRefreshFailed = Boolean(workspaces.error) && hasResolvedWorkspaceData;

  const allItems = useMemo(
    () => buildCloudWorkspaceInventoryItems(workspaceItems, { now: syncLabelNow }),
    [syncLabelNow, workspaceItems],
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
  const lastSyncedLabel = workspaceInventorySyncLabel(
    workspaces.dataUpdatedAt,
    syncLabelNow,
  );

  useEffect(() => {
    setSyncLabelNow(Date.now());
    if (!workspaces.dataUpdatedAt) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      setSyncLabelNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [workspaces.dataUpdatedAt]);

  return (
    <WorkspacesSurface
      groups={groups}
      filterOptions={filterOptions}
      selectedFilterId={filterId}
      groupOptions={WORKSPACE_INVENTORY_GROUP_OPTIONS}
      selectedGroupId={groupBy}
      summaryLabel={summaryLabel}
      lastSyncedLabel={lastSyncedLabel}
      loading={workspaces.isLoading && !hasResolvedWorkspaceData}
      error={Boolean(workspaces.error) && !hasResolvedWorkspaceData}
      backgroundRefreshFailed={backgroundRefreshFailed}
      isRefreshing={workspaces.isFetching}
      emptyTitle={filterId === "all" ? "No cloud-visible workspaces" : "No matching workspaces"}
      emptyDescription={
        filterId === "all"
          ? "Create a workspace from Home, Desktop, Slack, or an automation."
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
      onWorkspaceSelect={(workspaceId) => {
        const workspace = workspaceItems.find((item) => item.id === workspaceId);
        if (workspace?.lastSessionSummary?.sessionId) {
          navigate(routes.chat(workspace.id, workspace.lastSessionSummary.sessionId));
          return;
        }
        navigate(routes.workspace(workspaceId));
      }}
    />
  );
}
