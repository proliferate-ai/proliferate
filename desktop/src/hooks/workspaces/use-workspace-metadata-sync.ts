import { useEffect, useRef } from "react";
import { getAnyHarnessClient, useGitStatusQuery } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";
import {
  updateCloudWorkspaceBranch,
  updateCloudWorkspaceDisplayName,
} from "@/lib/integrations/cloud/workspaces";
import type {
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceDetail,
} from "@/lib/integrations/cloud/client";
import {
  type WorkspaceCollections,
  upsertCloudWorkspaceCollections,
} from "@/lib/domain/workspaces/collections";
import {
  buildRemoteLogicalWorkspaceId,
} from "@/lib/domain/workspaces/logical-workspaces";
import {
  CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS,
  markCloudDisplayNameSyncCompleted,
  resolveCloudDisplayNameSyncAttempt,
  shouldBackfillCloudDisplayNameFromRuntime,
  type CloudDisplayNameSyncState,
} from "@/lib/domain/workspaces/cloud-display-name-sync";
import { isCloudDisplayNameBackfillSuppressed } from "./cloud-display-name-backfill-suppression";
import { cloudMobilityWorkspacesKey } from "@/hooks/cloud/query-keys";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";

const WORKSPACE_METADATA_POLL_INTERVAL_MS = 250;

function buildLogicalIdForCloudWorkspace(workspace: CloudWorkspaceDetail): string {
  return buildRemoteLogicalWorkspaceId(
    workspace.repo.provider,
    workspace.repo.owner,
    workspace.repo.name,
    workspace.repo.branch,
  );
}

export function useWorkspaceMetadataSync() {
  const queryClient = useQueryClient();
  const syncingCloudBranchRef = useRef<string | null>(null);
  const syncingCloudDisplayNameRef = useRef<string | null>(null);
  const cloudDisplayNameSyncStateRef = useRef<CloudDisplayNameSyncState | null>(null);
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === selectedCloudRuntime.cloudWorkspaceId,
  ) ?? null;
  const activeSession = useHarnessStore((state) => (
    state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null
  ));
  const isRuntimeReadyForWorkspace =
    !selectedCloudRuntime.cloudWorkspaceId
    || selectedCloudRuntime.workspaceId !== selectedWorkspaceId
    || selectedCloudRuntime.state?.phase === "ready";

  const shouldPoll = !!selectedWorkspaceId
    && activeSession?.workspaceId === selectedWorkspaceId
    && isRuntimeReadyForWorkspace
    && resolveSessionViewState(activeSession) === "working"
    && !!selectedCloudWorkspace;

  const gitStatusQuery = useGitStatusQuery({
    enabled: !!selectedWorkspaceId && isRuntimeReadyForWorkspace && !hotPaintPending,
    refetchInterval: shouldPoll ? WORKSPACE_METADATA_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: shouldPoll,
  });

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    void gitStatusQuery.refetch();
  }, [gitStatusQuery.refetch, shouldPoll]);

  useEffect(() => {
    const currentBranch = gitStatusQuery.data?.currentBranch?.trim();
    if (!currentBranch) {
      return;
    }

    const cloudBranch = selectedCloudWorkspace?.repo.branch.trim() ?? null;
    const cloudBranchNeedsSync =
      !!selectedCloudWorkspace
      && !!cloudBranch
      && cloudBranch !== currentBranch;
    if (!cloudBranchNeedsSync) {
      return;
    }

    void (async () => {
      try {
        if (!selectedCloudWorkspace) {
          return;
        }
        const syncKey = `${selectedCloudWorkspace.id}:${currentBranch}`;
        if (syncingCloudBranchRef.current === syncKey) {
          return;
        }
        syncingCloudBranchRef.current = syncKey;
        const cloudWorkspace = await updateCloudWorkspaceBranch(
          selectedCloudWorkspace.id,
          currentBranch,
        );
        queryClient.setQueriesData<WorkspaceCollections | undefined>(
          { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
          (collections) => upsertCloudWorkspaceCollections(collections, cloudWorkspace),
        );
        queryClient.setQueryData<CloudMobilityWorkspaceSummary[] | undefined>(
          cloudMobilityWorkspacesKey(),
          (workspaces) => workspaces?.map((workspace) => (
            workspace.cloudWorkspaceId === cloudWorkspace.id
              ? {
                ...workspace,
                repo: {
                  ...workspace.repo,
                  branch: cloudWorkspace.repo.branch,
                },
                updatedAt: cloudWorkspace.updatedAt,
              }
              : workspace
          )),
        );
        const currentSelectedWorkspaceId = useHarnessStore.getState().selectedWorkspaceId;
        if (currentSelectedWorkspaceId === cloudWorkspaceSyntheticId(cloudWorkspace.id)) {
          useLogicalWorkspaceStore.getState().setSelectedLogicalWorkspaceId(
            buildLogicalIdForCloudWorkspace(cloudWorkspace),
          );
        }
        await queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        });
      } finally {
        if (selectedCloudWorkspace) {
          syncingCloudBranchRef.current = null;
        }
      }
    })();
  }, [
    gitStatusQuery.data?.currentBranch,
    queryClient,
    runtimeUrl,
    selectedCloudWorkspace,
  ]);

  useEffect(() => {
    if (
      !selectedCloudWorkspace
      || selectedCloudWorkspace.displayName?.trim()
      || selectedCloudRuntime.state?.phase !== "ready"
      || !selectedCloudRuntime.connectionInfo
      || isCloudDisplayNameBackfillSuppressed(selectedCloudWorkspace.id)
    ) {
      return;
    }

    const { runtimeUrl: cloudRuntimeUrl, accessToken, anyharnessWorkspaceId } =
      selectedCloudRuntime.connectionInfo;
    if (!anyharnessWorkspaceId) {
      return;
    }
    const selectedCloudWorkspaceId = selectedCloudWorkspace.id;
    const runtimeWorkspaceId = anyharnessWorkspaceId;

    async function attemptDisplayNameSync() {
      const syncKey = `${selectedCloudWorkspaceId}:${runtimeWorkspaceId}`;
      const decision = resolveCloudDisplayNameSyncAttempt({
        state: cloudDisplayNameSyncStateRef.current,
        syncKey,
        nowMs: Date.now(),
        inFlight: syncingCloudDisplayNameRef.current === syncKey,
      });
      cloudDisplayNameSyncStateRef.current = decision.state;
      if (!decision.shouldAttempt) {
        return;
      }

      syncingCloudDisplayNameRef.current = syncKey;
      try {
        const runtimeWorkspace = await getAnyHarnessClient({
          runtimeUrl: cloudRuntimeUrl,
          authToken: accessToken,
        }).workspaces.get(runtimeWorkspaceId);
        const backfill = shouldBackfillCloudDisplayNameFromRuntime({
          runtimeDisplayName: runtimeWorkspace.displayName,
          backfillSuppressed: isCloudDisplayNameBackfillSuppressed(selectedCloudWorkspaceId),
        });
        if (!backfill.shouldBackfill || !backfill.displayName) {
          return;
        }
        const cloudWorkspace = await updateCloudWorkspaceDisplayName(
          selectedCloudWorkspaceId,
          backfill.displayName,
        );
        cloudDisplayNameSyncStateRef.current = markCloudDisplayNameSyncCompleted(
          decision.state,
          syncKey,
        );
        queryClient.setQueriesData<WorkspaceCollections | undefined>(
          { queryKey: workspaceCollectionsScopeKey(runtimeUrl) },
          (collections) => upsertCloudWorkspaceCollections(collections, cloudWorkspace),
        );
        await queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        });
        queryClient.setQueryData<CloudMobilityWorkspaceSummary[] | undefined>(
          cloudMobilityWorkspacesKey(),
          (workspaces) => workspaces?.map((workspace) => (
            workspace.cloudWorkspaceId === cloudWorkspace.id
              ? {
                ...workspace,
                displayName: cloudWorkspace.displayName,
                updatedAt: cloudWorkspace.updatedAt,
              }
              : workspace
          )),
        );
      } catch {
        // Retry on the next interval while this blank cloud workspace remains selected.
      } finally {
        syncingCloudDisplayNameRef.current = null;
      }
    }

    void attemptDisplayNameSync();
    const intervalId = window.setInterval(
      () => void attemptDisplayNameSync(),
      CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS,
    );
    return () => window.clearInterval(intervalId);
  }, [
    queryClient,
    runtimeUrl,
    selectedCloudRuntime.connectionInfo,
    selectedCloudRuntime.state?.phase,
    selectedCloudWorkspace,
  ]);

  return gitStatusQuery;
}
