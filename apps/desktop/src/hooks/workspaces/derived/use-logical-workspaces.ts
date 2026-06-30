import { useMemo } from "react";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import { useStandardRepoProjection } from "./use-standard-repo-projection";

const EMPTY_LOGICAL_WORKSPACES: LogicalWorkspace[] = [];

export function useLogicalWorkspaces() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { repoRoots, localWorkspaces, cloudWorkspaces, isLoading } = useStandardRepoProjection();

  const logicalWorkspaces = useMemo(() => {
    if (repoRoots.length === 0 && localWorkspaces.length === 0 && cloudWorkspaces.length === 0) {
      return EMPTY_LOGICAL_WORKSPACES;
    }

    return buildLogicalWorkspaces({
      localWorkspaces,
      repoRoots,
      cloudWorkspaces,
      currentSelectionId: selectedWorkspaceId,
    });
  }, [cloudWorkspaces, localWorkspaces, repoRoots, selectedWorkspaceId]);

  return {
    logicalWorkspaces,
    isLoading,
  };
}
