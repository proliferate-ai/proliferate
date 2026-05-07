import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { clearWorkspaceRuntimeState } from "@/hooks/workspaces/selection/clear-runtime-state";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import {
  getWorkspace,
  purgeWorkspace,
  retryPurgeWorkspace,
  retryRetireWorkspaceCleanup,
} from "@/lib/access/anyharness/workspaces";

export function useWorkspaceRetireActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const clearSelection = useSessionSelectionStore((state) => state.clearSelection);
  const setSelectedLogicalWorkspaceId = useSessionSelectionStore(
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
      const connection = { runtimeUrl };
      const result = await purgeWorkspace(connection, workspaceId);
      if (result.outcome === "deleted") {
        clearFinishSuggestionDismissal(workspaceId);
        const selectedWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
        const selectedLogicalWorkspaceId =
          useSessionSelectionStore.getState().selectedLogicalWorkspaceId;
        const targetIsSelected =
          selectedWorkspaceId === workspaceId
          || (
            options.logicalWorkspaceId != null
            && selectedLogicalWorkspaceId === options.logicalWorkspaceId
          );
        clearWorkspaceRuntimeState(
          {
            removeWorkspaceSlots: (removedWorkspaceId) => {
              const removedSessionIds =
                useSessionDirectoryStore.getState().removeWorkspaceEntries(removedWorkspaceId);
              useSessionTranscriptStore.getState().removeEntries(removedSessionIds);
            },
            clearSelection,
          },
          workspaceId,
          { clearSelection: targetIsSelected },
        );
        if (targetIsSelected) {
          setSelectedLogicalWorkspaceId(null);
          navigate(APP_ROUTES.home);
        }
      }
      await refresh();
      return result;
    },
    retryCleanup: async (workspaceId: string) => {
      const connection = { runtimeUrl };
      const workspace = await getWorkspace(connection, workspaceId);
      const result = workspace.cleanupOperation === "purge"
        ? await retryPurgeWorkspace(connection, workspaceId)
        : await retryRetireWorkspaceCleanup(connection, workspaceId);
      await refresh();
      return result;
    },
  };
}
