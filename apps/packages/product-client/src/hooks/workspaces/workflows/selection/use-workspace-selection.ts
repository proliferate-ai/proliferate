import { useCallback } from "react";
import type { Workspace } from "@anyharness/sdk";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceBootstrapActions } from "#product/hooks/workspaces/workflows/use-workspace-bootstrap-actions";
import { useWorkspaceSelectionCache } from "#product/hooks/workspaces/cache/use-workspace-selection-cache";
import { buildLogicalWorkspaces } from "#product/lib/domain/workspaces/cloud/logical-workspaces";
import { buildStandardRepoProjection } from "#product/lib/domain/workspaces/cloud/standard-projection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { clearWorkspaceRuntimeState } from "#product/hooks/workspaces/workflows/selection/clear-runtime-state";
import { runHotWorkspaceReopen } from "#product/hooks/workspaces/workflows/selection/run-hot-workspace-reopen";
import { runWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/run-workspace-selection";

function removeWorkspaceSessionRecordsForWorkspace(workspaceId: string): void {
  const removedSessionIds =
    useSessionDirectoryStore.getState().removeWorkspaceEntries(workspaceId);
  useSessionTranscriptStore.getState().removeEntries(removedSessionIds);
}

export function useWorkspaceSelection() {
  const host = useProductHost();
  const desktop = host.desktop;
  const localRuntime = desktop?.runtime ?? null;
  const cloudClient = host.cloud.client;
  const {
    cancelPreviousWorkspaceDisplayQueries,
    getWorkspaceSelectionSnapshot,
  } = useWorkspaceSelectionCache();
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
        forceSessionDirectoryRefresh?: boolean;
        preservePending?: boolean;
        initialActiveSessionId?: string | null;
        latencyFlowId?: string | null;
        knownWorkspace?: Workspace | null;
      },
    ) => {
      const runtimeUrl = useHarnessConnectionStore.getState().runtimeUrl;
      const {
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
          currentSelectionId: useSessionSelectionStore.getState().selectedWorkspaceId,
        })
        : [];
      const deps = {
        localRuntime,
        cloudClient,
        cache: {
          cancelPreviousWorkspaceDisplayQueries,
        },
        logicalWorkspaces,
        rawWorkspaces: workspaceCollections?.localWorkspaces ?? [],
        setSelectedLogicalWorkspaceId,
        setSelectedWorkspace: (
          id: string,
          opts?: { initialActiveSessionId?: string | null },
        ) => setSelectedWorkspace({
          logicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
          workspaceId: id,
          initialActiveSessionId: opts?.initialActiveSessionId,
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
      localRuntime,
      reconcileHotWorkspace,
      setSelectedLogicalWorkspaceId,
      setSelectedWorkspace,
      cloudClient,
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
