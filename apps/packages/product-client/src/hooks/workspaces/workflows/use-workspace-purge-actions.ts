import { APP_ROUTES } from "#product/config/app-routes";
import { navigateApp } from "#product/lib/workflows/app/app-navigate-handoff";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { clearWorkspaceRuntimeState } from "#product/hooks/workspaces/workflows/selection/clear-runtime-state";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { purgeWorkspace } from "#product/lib/access/anyharness/workspaces";

// navigateApp instead of useNavigate: purge actions run only inside click
// callbacks, and useNavigate would subscribe the sidebar to every location
// change (PRO-170, PRO-182).
export function useWorkspacePurgeActions() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const refresh = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const clearSelection = useSessionSelectionStore((state) => state.clearSelection);
  const setSelectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.setSelectedLogicalWorkspaceId,
  );

  return {
    markDone: async (
      workspaceId: string,
      options: { logicalWorkspaceId?: string | null } = {},
    ) => {
      const connection = { runtimeUrl };
      const result = await purgeWorkspace(connection, workspaceId);
      if (result.outcome === "deleted") {
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
          navigateApp(APP_ROUTES.home);
        }
      }
      await refresh();
      return result;
    },
  };
}
