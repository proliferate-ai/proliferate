import { useCallback } from "react";
import { type CoworkStatus } from "@anyharness/sdk";
import { anyHarnessCoworkStatusKey } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceBootstrapActions } from "@/hooks/workspaces/use-workspace-bootstrap-actions";
import type { CloudMobilityWorkspaceSummary } from "@/lib/access/cloud/client";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/logical-workspaces";
import { buildStandardRepoProjection } from "@/lib/domain/workspaces/standard-projection";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";
import { getWorkspaceCollectionsFromCache } from "@/hooks/workspaces/query-keys";
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
  const queryClient = useQueryClient();
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
      const workspaceCollections = getWorkspaceCollectionsFromCache(queryClient, runtimeUrl);
      const cloudMobilityWorkspaces = queryClient.getQueryData<CloudMobilityWorkspaceSummary[]>(
        cloudMobilityWorkspacesKey(),
      );
      const coworkStatus = queryClient.getQueryData<CoworkStatus>(
        anyHarnessCoworkStatusKey(runtimeUrl),
      );
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
        queryClient,
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
      clearSelection,
      queryClient,
      reconcileHotWorkspace,
      setSelectedLogicalWorkspaceId,
      setSelectedWorkspace,
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
