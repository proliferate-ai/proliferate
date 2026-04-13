import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { humanizeBranchName } from "@/lib/domain/workspaces/branch-naming";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud-ids";
import { workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useSidebarSupportContext() {
  const location = useLocation();
  const { data: workspaceCollections } = useWorkspaces();
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);

  return useMemo(() => {
    const pathname = `${location.pathname}${location.search}`;
    const localWorkspaces = workspaceCollections?.workspaces ?? [];
    const cloudWorkspaces = workspaceCollections?.cloudWorkspaces ?? [];

    if (!selectedWorkspaceId) {
      return {
        source: "sidebar" as const,
        intent: "general" as const,
        pathname,
      };
    }

    if (isCloudWorkspaceId(selectedWorkspaceId)) {
      const cloudId = selectedWorkspaceId.slice("cloud:".length);
      const workspace = cloudWorkspaces.find((entry) => entry.id === cloudId);
      return {
        source: "sidebar" as const,
        intent: "general" as const,
        pathname,
        workspaceId: selectedWorkspaceId,
        workspaceName: workspace?.repo.branch
          ? humanizeBranchName(workspace.repo.branch)
          : workspace?.repo.name,
        workspaceLocation: "cloud" as const,
      };
    }

    const workspace = localWorkspaces.find((entry) => entry.id === selectedWorkspaceId);
    return {
      source: "sidebar" as const,
      intent: "general" as const,
      pathname,
      workspaceId: selectedWorkspaceId,
      workspaceName: workspace ? workspaceDisplayName(workspace) : undefined,
      workspaceLocation: "local" as const,
    };
  }, [location.pathname, location.search, selectedWorkspaceId, workspaceCollections]);
}
