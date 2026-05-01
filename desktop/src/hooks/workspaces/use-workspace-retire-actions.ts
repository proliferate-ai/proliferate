import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

export function useWorkspaceRetireActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const clearSelection = useHarnessStore((state) => state.clearSelection);
  const setSelectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.setSelectedLogicalWorkspaceId,
  );
  const clearFinishSuggestionDismissal = useWorkspaceUiStore(
    (state) => state.clearFinishSuggestionDismissal,
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    });
  };

  return {
    markDone: async (
      workspaceId: string,
      options: { logicalWorkspaceId?: string | null } = {},
    ) => {
      const client = getAnyHarnessClient({ runtimeUrl });
      const result = await client.workspaces.retire(workspaceId);
      await refresh();
      if (result.outcome === "retired" || result.outcome === "already_retired") {
        clearFinishSuggestionDismissal(workspaceId);
        const selectedWorkspaceId = useHarnessStore.getState().selectedWorkspaceId;
        const selectedLogicalWorkspaceId =
          useLogicalWorkspaceStore.getState().selectedLogicalWorkspaceId;
        const targetIsSelected =
          selectedWorkspaceId === workspaceId
          || (
            options.logicalWorkspaceId != null
            && selectedLogicalWorkspaceId === options.logicalWorkspaceId
          );
        if (targetIsSelected) {
          clearSelection();
          setSelectedLogicalWorkspaceId(null);
          navigate(APP_ROUTES.home);
        }
      }
      return result;
    },
    retryCleanup: async (workspaceId: string) => {
      const client = getAnyHarnessClient({ runtimeUrl });
      const result = await client.workspaces.retryRetireCleanup(workspaceId);
      await refresh();
      return result;
    },
  };
}
