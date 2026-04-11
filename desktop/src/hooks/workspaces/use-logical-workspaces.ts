import { useMemo } from "react";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { useCloudMobilityWorkspaces } from "@/hooks/cloud/use-cloud-mobility-workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/logical-workspaces";
import { useWorkspaces } from "./use-workspaces";

const EMPTY_LOGICAL_WORKSPACES: LogicalWorkspace[] = [];

export function useLogicalWorkspaces() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections, isLoading } = useWorkspaces();
  const { data: cloudMobilityWorkspaces } = useCloudMobilityWorkspaces();

  const logicalWorkspaces = useMemo(() => {
    if (!workspaceCollections) {
      return EMPTY_LOGICAL_WORKSPACES;
    }

    return buildLogicalWorkspaces({
      localWorkspaces: workspaceCollections.localWorkspaces,
      repoRoots: workspaceCollections.repoRoots,
      cloudWorkspaces: workspaceCollections.cloudWorkspaces,
      cloudMobilityWorkspaces,
      currentSelectionId: selectedWorkspaceId,
    });
  }, [cloudMobilityWorkspaces, selectedWorkspaceId, workspaceCollections]);

  return {
    logicalWorkspaces,
    isLoading,
  };
}
