import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceBootstrapActions } from "@/hooks/workspaces/workflows/use-workspace-bootstrap-actions";
import { useCloudWorkspaceConnectionCache } from "@/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useWorkspaceSelectionCache } from "@/hooks/workspaces/cache/use-workspace-selection-cache";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import { buildStandardRepoProjection } from "@/lib/domain/workspaces/cloud/standard-projection";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { clearWorkspaceRuntimeState } from "./clear-runtime-state";
import { runHotWorkspaceReopen } from "./run-hot-workspace-reopen";
import { runWorkspaceSelection } from "./run-workspace-selection";

function removeWorkspaceSessionRecordsForWorkspace(workspaceId: string): void {
  const removedSessionIds =
    useSessionDirectoryStore.getState().removeWorkspaceEntries(workspaceId);
  useSessionTranscriptStore.getState().removeEntries(removedSessionIds);
}

export function useWorkspaceSelection() {
  const desktop = useProductHost().desktop;
  const localRuntime = desktop?.runtime ?? null;
  const ssh = desktop?.ssh ?? null;
  const {
    cancelPreviousWorkspaceDisplayQueries,
    getWorkspaceSelectionSnapshot,
    invalidateCloudWorkspaceStartState,
  } = useWorkspaceSelectionCache();
  const { refreshCloudWorkspaceConnection } = useCloudWorkspaceConnectionCache();
  const setSelectedWorkspace = useSessionSelectionStore((state) => state.activateWorkspace);
  const clearSelection = useSessionSelectionStore((state) => state.clearSelection);
  const setSelectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.setSelectedLogicalWorkspaceId,
  );
  const { bootstrapWorkspace, reconcileHotWorkspace } = useWorkspaceBootstrapActions();

  return {
    selectWorkspace: useCallback(async (
      workspaceId: string,
      options?: {
        force?: boolean;
        forceCold?: boolean;
        preservePending?: boolean;
        initialActiveSessionId?: string | null;
        latencyFlowId?: string | null;
      },
    ) => {
      const runtimeUrl = useHarnessConnectionStore.getState().runtimeUrl;
      const {
        cloudMobilityWorkspaces,
        coworkStatus,
        workspaceCollections,
      } = getWorkspaceSelectionSnapshot(runtimeUrl);
      const standardProjection = workspaceCollections
        ? buildStandardRepoProjection({
          repoRoots: workspaceCollections.repoRoots,
          localWorkspaces: workspaceCollections.localWorkspaces,
          cloudWorkspaces: workspaceCollections.cloudWorkspaces,
          coworkRootRepoRootId: coworkStatus?.root?.repoRootId ?? null,
        })
        : null;
      const logicalWorkspaces = workspaceCollections
        ? buildLogicalWorkspaces({
          localWorkspaces: standardProjection?.localWorkspaces ?? [],
          repoRoots: standardProjection?.repoRoots ?? [],
          cloudWorkspaces: standardProjection?.cloudWorkspaces ?? [],
          cloudMobilityWorkspaces,
          currentSelectionId: useSessionSelectionStore.getState().selectedWorkspaceId,
        })
        : [];
      const deps = {
        localRuntime,
        ssh,
        cache: {
          cancelPreviousWorkspaceDisplayQueries,
          invalidateCloudWorkspaceStartState,
          refreshCloudWorkspaceConnection,
        },
        logicalWorkspaces,
        rawWorkspaces: workspaceCollections?.localWorkspaces ?? [],
        setSelectedLogicalWorkspaceId,
        setSelectedWorkspace: (
          id: string,
          opts?: { initialActiveSessionId?: string | null; clearPending?: boolean },
        ) => setSelectedWorkspace({
          logicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
          workspaceId: id,
          initialActiveSessionId: opts?.initialActiveSessionId,
          clearPending: opts?.clearPending,
        }),
        removeWorkspaceSlots: removeWorkspaceSessionRecordsForWorkspace,
        clearSelection,
        bootstrapWorkspace,
        reconcileHotWorkspace,
      };
      if (runHotWorkspaceReopen(deps, {
        workspaceId,
        options,
      })) {
        return;
      }
      await runWorkspaceSelection(deps, {
        workspaceId,
        options,
      });
    }, [
      bootstrapWorkspace,
      cancelPreviousWorkspaceDisplayQueries,
      clearSelection,
      getWorkspaceSelectionSnapshot,
      invalidateCloudWorkspaceStartState,
      localRuntime,
      reconcileHotWorkspace,
      refreshCloudWorkspaceConnection,
      setSelectedLogicalWorkspaceId,
      setSelectedWorkspace,
      ssh,
    ]),
    clearWorkspaceRuntimeState: useCallback((
      workspaceId: string,
      options?: { clearSelection?: boolean; clearDraftUiKey?: string | null },
    ) => {
      const currentSelectedWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
      clearWorkspaceRuntimeState(
        {
          removeWorkspaceSlots: removeWorkspaceSessionRecordsForWorkspace,
          clearSelection,
        },
        workspaceId,
        options,
      );
      if (options?.clearSelection && currentSelectedWorkspaceId === workspaceId) {
        setSelectedLogicalWorkspaceId(null);
      }
    }, [clearSelection, setSelectedLogicalWorkspaceId]),
  };
}
