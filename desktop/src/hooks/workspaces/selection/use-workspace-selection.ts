import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceBootstrapActions } from "@/hooks/workspaces/use-workspace-bootstrap-actions";
import type { CloudMobilityWorkspaceSummary } from "@/lib/integrations/cloud/client";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/logical-workspaces";
import { cloudMobilityWorkspacesKey } from "@/hooks/cloud/query-keys";
import { getWorkspaceCollectionsFromCache } from "@/hooks/workspaces/query-keys";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { clearWorkspaceRuntimeState } from "./clear-runtime-state";
import { runWorkspaceSelection } from "./run-workspace-selection";

export function useWorkspaceSelection() {
  const queryClient = useQueryClient();
  const setSelectedWorkspace = useHarnessStore((state) => state.setSelectedWorkspace);
  const removeWorkspaceSlots = useHarnessStore((state) => state.removeWorkspaceSlots);
  const clearSelection = useHarnessStore((state) => state.clearSelection);
  const setSelectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.setSelectedLogicalWorkspaceId,
  );
  const { bootstrapWorkspace } = useWorkspaceBootstrapActions();

  return {
    selectWorkspace: useCallback(async (
      workspaceId: string,
      options?: { force?: boolean; preservePending?: boolean; latencyFlowId?: string | null },
    ) => {
      const runtimeUrl = useHarnessStore.getState().runtimeUrl;
      const workspaceCollections = getWorkspaceCollectionsFromCache(queryClient, runtimeUrl);
      const cloudMobilityWorkspaces = queryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
        cloudMobilityWorkspacesKey(),
      );
      const logicalWorkspaces = workspaceCollections
        ? buildLogicalWorkspaces({
          localWorkspaces: workspaceCollections.localWorkspaces,
          repoRoots: workspaceCollections.repoRoots,
          cloudWorkspaces: workspaceCollections.cloudWorkspaces,
          cloudMobilityWorkspaces,
          currentSelectionId: useHarnessStore.getState().selectedWorkspaceId,
        })
        : [];

      await runWorkspaceSelection({
        queryClient,
        logicalWorkspaces,
        setSelectedLogicalWorkspaceId,
        setSelectedWorkspace,
        removeWorkspaceSlots,
        clearSelection,
        bootstrapWorkspace,
      }, {
        workspaceId,
        options,
      });
    }, [
      bootstrapWorkspace,
      clearSelection,
      queryClient,
      removeWorkspaceSlots,
      setSelectedLogicalWorkspaceId,
      setSelectedWorkspace,
    ]),
    clearWorkspaceRuntimeState: useCallback((
      workspaceId: string,
      options?: { clearSelection?: boolean },
    ) => {
      const currentSelectedWorkspaceId = useHarnessStore.getState().selectedWorkspaceId;
      clearWorkspaceRuntimeState(
        {
          removeWorkspaceSlots,
          clearSelection,
        },
        workspaceId,
        options,
      );
      if (options?.clearSelection && currentSelectedWorkspaceId === workspaceId) {
        setSelectedLogicalWorkspaceId(null);
      }
    }, [clearSelection, removeWorkspaceSlots, setSelectedLogicalWorkspaceId]),
  };
}
