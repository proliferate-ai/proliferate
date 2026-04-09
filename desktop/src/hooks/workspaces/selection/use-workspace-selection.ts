import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceBootstrapActions } from "@/hooks/workspaces/use-workspace-bootstrap-actions";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { clearWorkspaceRuntimeState } from "./clear-runtime-state";
import { runWorkspaceSelection } from "./run-workspace-selection";

export function useWorkspaceSelection() {
  const queryClient = useQueryClient();
  const setSelectedWorkspace = useHarnessStore((state) => state.setSelectedWorkspace);
  const removeWorkspaceSlots = useHarnessStore((state) => state.removeWorkspaceSlots);
  const clearSelection = useHarnessStore((state) => state.clearSelection);
  const { bootstrapWorkspace } = useWorkspaceBootstrapActions();

  return {
    selectWorkspace: useCallback(async (
      workspaceId: string,
      options?: { force?: boolean; preservePending?: boolean; latencyFlowId?: string | null },
    ) => {
      await runWorkspaceSelection({
        queryClient,
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
      setSelectedWorkspace,
    ]),
    clearWorkspaceRuntimeState: useCallback((
      workspaceId: string,
      options?: { clearSelection?: boolean },
    ) => {
      clearWorkspaceRuntimeState(
        {
          removeWorkspaceSlots,
          clearSelection,
        },
        workspaceId,
        options,
      );
    }, [clearSelection, removeWorkspaceSlots]),
  };
}
