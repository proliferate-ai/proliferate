import { useEffect, useRef } from "react";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { resolveSessionViewState } from "@proliferate/product-domain/sessions/activity";
import {
  updateCloudWorkspaceBranch,
  updateCloudWorkspaceDisplayName,
} from "@proliferate/cloud-sdk/client/workspaces";
import type {
  CloudWorkspaceDetail,
} from "@/lib/access/cloud/client";
import {
  buildRemoteLogicalWorkspaceId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS,
  markCloudDisplayNameSyncCompleted,
  resolveCloudDisplayNameSyncAttempt,
  shouldBackfillCloudDisplayNameFromRuntime,
  type CloudDisplayNameSyncState,
} from "@/lib/domain/workspaces/cloud/cloud-display-name-sync";
import { isCloudDisplayNameBackfillSuppressed } from "./cloud-display-name-backfill-suppression";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { getWorkspace } from "@/lib/access/anyharness/workspaces";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";
import { useWorkspaceCollectionsInvalidation } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceCollectionsMutationCache } from "@/hooks/workspaces/cache/use-workspace-collections-mutation-cache";
import { withFreshManagedSandboxGatewayAccessToken } from "@/lib/access/cloud/managed-sandbox-gateway";

const WORKSPACE_METADATA_POLL_INTERVAL_MS = 250;

function buildLogicalIdForCloudWorkspace(workspace: CloudWorkspaceDetail): string {
  return buildRemoteLogicalWorkspaceId(
    workspace.repo.provider,
    workspace.repo.owner,
    workspace.repo.name,
    workspace.repo.branch,
  );
}

// Owns mounted metadata synchronization for the selected workspace.
// Display state and user-triggered workspace actions live in sibling hook folders.
export function useWorkspaceMetadataSync() {
  const syncingCloudBranchRef = useRef<string | null>(null);
  const syncingCloudDisplayNameRef = useRef<string | null>(null);
  const cloudDisplayNameSyncStateRef = useRef<CloudDisplayNameSyncState | null>(null);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const { upsertCloudWorkspace } = useWorkspaceCollectionsMutationCache(runtimeUrl);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudWorkspace = workspaceCollections?.cloudWorkspaces.find(
    (workspace) => workspace.id === selectedCloudRuntime.cloudWorkspaceId,
  ) ?? null;
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeSession = useSessionDirectoryStore((state) => (
    activeSessionId ? state.entriesById[activeSessionId] ?? null : null
  ));
  const isRuntimeReadyForWorkspace =
    !selectedCloudRuntime.cloudWorkspaceId
    || selectedCloudRuntime.workspaceId !== selectedWorkspaceId
    || selectedCloudRuntime.state?.phase === "ready";

  const shouldPoll = !!selectedWorkspaceId
    && activeSession?.workspaceId === selectedWorkspaceId
    && isRuntimeReadyForWorkspace
    && resolveSessionViewState(activitySnapshotFromDirectoryEntry(activeSession)) === "working"
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
        const requestedCloudWorkspaceId = selectedCloudWorkspace.id;
        syncingCloudBranchRef.current = syncKey;
        const cloudWorkspace = await updateCloudWorkspaceBranch(
          requestedCloudWorkspaceId,
          currentBranch,
        );
        upsertCloudWorkspace(cloudWorkspace);
        const currentSelectedWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
        if (
          currentSelectedWorkspaceId === cloudWorkspaceSyntheticId(requestedCloudWorkspaceId)
          || currentSelectedWorkspaceId === cloudWorkspaceSyntheticId(cloudWorkspace.id)
        ) {
          useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId(
            buildLogicalIdForCloudWorkspace(cloudWorkspace),
          );
        }
        await invalidateWorkspaceCollections();
      } finally {
        if (selectedCloudWorkspace) {
          syncingCloudBranchRef.current = null;
        }
      }
    })();
  }, [
    gitStatusQuery.data?.currentBranch,
    invalidateWorkspaceCollections,
    selectedCloudWorkspace,
    upsertCloudWorkspace,
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

    const connectionInfo = selectedCloudRuntime.connectionInfo;
    const { anyharnessWorkspaceId } = connectionInfo;
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
        const { runtimeUrl: cloudRuntimeUrl, accessToken } =
          await withFreshManagedSandboxGatewayAccessToken(connectionInfo);
        const runtimeWorkspace = await getWorkspace({
          runtimeUrl: cloudRuntimeUrl,
          authToken: accessToken,
        }, runtimeWorkspaceId);
        const backfill = shouldBackfillCloudDisplayNameFromRuntime({
          runtimeDisplayName: runtimeWorkspace.displayName,
          runtimeWorkspaceId,
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
        upsertCloudWorkspace(cloudWorkspace);
        await invalidateWorkspaceCollections();
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
    invalidateWorkspaceCollections,
    runtimeUrl,
    selectedCloudRuntime.connectionInfo,
    selectedCloudRuntime.state?.phase,
    selectedCloudWorkspace,
    upsertCloudWorkspace,
  ]);

  return gitStatusQuery;
}
