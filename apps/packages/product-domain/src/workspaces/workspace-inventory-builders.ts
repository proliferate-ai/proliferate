import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import { cloudWorkspaceInventoryItem, sortedCloudWorkspaces } from "./inventory-cloud";
import type {
  BuildCloudWorkspaceInventoryOptions,
  WorkspaceInventoryGroupBy,
  WorkspaceInventoryGroupView,
  WorkspaceInventoryItemView,
} from "./workspace-inventory-types";
import { groupWorkspaceInventoryItems } from "./workspace-inventory-groups";

export function buildCloudWorkspaceInventoryItems(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildCloudWorkspaceInventoryOptions = {},
): WorkspaceInventoryItemView[] {
  const now = options.now ?? Date.now();
  return sortedCloudWorkspaces(workspaces).map((workspace) =>
    cloudWorkspaceInventoryItem(workspace, now),
  );
}

export function buildCloudWorkspaceInventoryGroups(
  workspaces: readonly CloudWorkspaceSummary[],
  groupBy: WorkspaceInventoryGroupBy = "source",
  options: BuildCloudWorkspaceInventoryOptions = {},
): WorkspaceInventoryGroupView[] {
  return groupWorkspaceInventoryItems(
    buildCloudWorkspaceInventoryItems(workspaces, options),
    groupBy,
  );
}
