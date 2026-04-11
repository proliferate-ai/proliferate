import { useMemo } from "react";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { useCloudMobilityWorkspaces } from "@/hooks/cloud/use-cloud-mobility-workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/logical-workspaces";
import { useStandardRepoProjection } from "./use-standard-repo-projection";

const EMPTY_LOGICAL_WORKSPACES: LogicalWorkspace[] = [];

export function useLogicalWorkspaces() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { repoRoots, localWorkspaces, cloudWorkspaces, isLoading } = useStandardRepoProjection();
  const { data: cloudMobilityWorkspaces } = useCloudMobilityWorkspaces();

  const logicalWorkspaces = useMemo(() => {
    if (repoRoots.length === 0 && localWorkspaces.length === 0 && cloudWorkspaces.length === 0) {
      return EMPTY_LOGICAL_WORKSPACES;
    }

    return buildLogicalWorkspaces({
      localWorkspaces,
      repoRoots,
      cloudWorkspaces,
      cloudMobilityWorkspaces,
      currentSelectionId: selectedWorkspaceId,
    });
  }, [cloudMobilityWorkspaces, cloudWorkspaces, localWorkspaces, repoRoots, selectedWorkspaceId]);

  return {
    logicalWorkspaces,
    isLoading,
  };
}
