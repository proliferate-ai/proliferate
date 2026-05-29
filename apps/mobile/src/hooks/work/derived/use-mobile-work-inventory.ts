import { useMemo } from "react";
import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";
import { useVisibleCloudWorkspaces } from "@proliferate/cloud-sdk-react";
import {
  buildCloudWorkRecencyInventory,
  type CloudWorkFilters,
  type CloudWorkRecencyGroupView,
  type CloudWorkItemView,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import type { MobileCloudChat } from "../../../navigation/navigation-model";

export interface MobileWorkItem {
  view: CloudWorkItemView;
  workspace: CloudWorkspaceSummary;
  chat: MobileCloudChat;
}

export interface MobileWorkGroup {
  view: CloudWorkRecencyGroupView;
  items: MobileWorkItem[];
}

export interface MobileWorkInventory {
  groups: MobileWorkGroup[];
  items: MobileWorkItem[];
  recentItems: MobileWorkItem[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useMobileWorkInventory(filters?: CloudWorkFilters): MobileWorkInventory {
  const visibleWorkspaces = useVisibleCloudWorkspaces();
  const data = visibleWorkspaces.data;

  const inventory = useMemo(() => {
    const workspaceById = new Map(data.map((workspace) => [workspace.id, workspace]));
    const groups = buildCloudWorkRecencyInventory(data, { filters }).map((group) => ({
      view: group,
      items: group.items.flatMap((item) => {
        const workspace = workspaceById.get(item.id);
        if (!workspace) {
          return [];
        }
        return [{
          view: item,
          workspace,
          chat: mobileCloudChatForWorkspace(workspace, item),
        }];
      }),
    }));
    const items = groups.flatMap((group) => group.items);
    const recentItems = [...items]
      .sort((left, right) => right.view.lastActivityMs - left.view.lastActivityMs)
      .slice(0, 5);
    return { groups, items, recentItems };
  }, [data, filters]);

  return {
    ...inventory,
    error: visibleWorkspaces.error instanceof Error ? visibleWorkspaces.error : null,
    isFetching: visibleWorkspaces.isFetching,
    isLoading: visibleWorkspaces.isLoading,
    refetch: visibleWorkspaces.refetch,
  };
}

export function mobileCloudChatForWorkspace(
  workspace: CloudWorkspaceSummary,
  item?: CloudWorkItemView,
): MobileCloudChat {
  const session = workspace.lastSessionSummary;
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.displayName ?? session?.title ?? workspace.repo.name,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: session?.targetId ?? workspace.targetId ?? null,
    workspaceRuntimeId: session?.workspaceId ?? cloudWorkspaceRuntimeId(workspace),
    sessionId: item?.defaultSessionId ?? session?.sessionId ?? null,
    title: session?.title ?? item?.title ?? workspace.displayName ?? workspace.repo.name,
    status: session?.status ?? workspace.workspaceStatus ?? workspace.status,
    visibility: workspace.visibility,
  };
}

function cloudWorkspaceRuntimeId(workspace: CloudWorkspaceSummary): string | null {
  const detail = workspace as CloudWorkspaceSummary & { anyharnessWorkspaceId?: string | null };
  return detail.anyharnessWorkspaceId ?? null;
}
