import { useEffect, useRef } from "react";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";
import { updateCloudWorkspaceBranch } from "@/lib/integrations/cloud/workspaces";
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
  replaceLogicalWorkspaceBranch,
} from "@/lib/domain/workspaces/logical-workspaces";
import { cloudMobilityWorkspacesKey } from "@/hooks/cloud/query-keys";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useBranchRenameStore } from "@/stores/workspaces/branch-rename-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";

const BRANCH_RENAME_POLL_INTERVAL_MS = 250;
const BRANCH_RENAME_TIMEOUT_MS = 60_000;

function buildLogicalIdForCloudWorkspace(workspace: CloudWorkspaceDetail): string {
  return buildRemoteLogicalWorkspaceId(
    workspace.repo.provider,
    workspace.repo.owner,
    workspace.repo.name,
    workspace.repo.branch,
  );
}

export function useWorkspaceBranchRenameMonitor() {
  const queryClient = useQueryClient();
  const syncingCloudBranchRef = useRef<string | null>(null);
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
  const pendingRename = useBranchRenameStore((state) => (
    selectedWorkspaceId ? state.pendingByWorkspaceId[selectedWorkspaceId] ?? null : null
  ));
  const clearPendingRename = useBranchRenameStore((state) => state.clearPendingRename);
  const isRuntimeReadyForWorkspace =
    !selectedCloudRuntime.cloudWorkspaceId
    || selectedCloudRuntime.workspaceId !== selectedWorkspaceId
    || selectedCloudRuntime.state?.phase === "ready";

  const shouldPoll = !!selectedWorkspaceId
    && activeSession?.workspaceId === selectedWorkspaceId
    && isRuntimeReadyForWorkspace
    && resolveSessionViewState(activeSession) === "working"
    && (!!pendingRename || !!selectedCloudWorkspace);

  const gitStatusQuery = useGitStatusQuery({
    enabled: !!selectedWorkspaceId && isRuntimeReadyForWorkspace && !hotPaintPending,
    refetchInterval: shouldPoll ? BRANCH_RENAME_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: shouldPoll,
  });

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    void gitStatusQuery.refetch();
  }, [gitStatusQuery.refetch, pendingRename?.placeholderBranch, shouldPoll]);

  useEffect(() => {
    if (!pendingRename) {
      return;
    }

    const remaining = BRANCH_RENAME_TIMEOUT_MS - (Date.now() - pendingRename.startedAt);
    if (remaining <= 0) {
      clearPendingRename(pendingRename.workspaceId);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      clearPendingRename(pendingRename.workspaceId);
    }, remaining);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clearPendingRename, pendingRename]);

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
    const pendingRenameCompleted =
      !!pendingRename
      && currentBranch !== pendingRename.placeholderBranch;
    if (!cloudBranchNeedsSync && !pendingRenameCompleted) {
      return;
    }

    const completedRename = pendingRename;

    void (async () => {
      try {
        if (selectedCloudWorkspace) {
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
          if (
            currentSelectedWorkspaceId === completedRename?.workspaceId
            || currentSelectedWorkspaceId === cloudWorkspaceSyntheticId(cloudWorkspace.id)
          ) {
            useLogicalWorkspaceStore.getState().setSelectedLogicalWorkspaceId(
              buildLogicalIdForCloudWorkspace(cloudWorkspace),
            );
          }
        } else if (
          completedRename
          && useHarnessStore.getState().selectedWorkspaceId === completedRename.workspaceId
        ) {
          const selectedLogicalWorkspaceId =
            useLogicalWorkspaceStore.getState().selectedLogicalWorkspaceId;
          const nextLogicalWorkspaceId = replaceLogicalWorkspaceBranch(
            selectedLogicalWorkspaceId,
            currentBranch,
          );
          if (nextLogicalWorkspaceId) {
            useLogicalWorkspaceStore.getState().setSelectedLogicalWorkspaceId(
              nextLogicalWorkspaceId,
            );
          }
        }
        await queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        });
      } finally {
        if (selectedCloudWorkspace) {
          syncingCloudBranchRef.current = null;
        }
        if (completedRename) {
          clearPendingRename(completedRename.workspaceId);
        }
      }
    })();
  }, [
    clearPendingRename,
    gitStatusQuery.data?.currentBranch,
    pendingRename,
    queryClient,
    runtimeUrl,
    selectedCloudWorkspace,
  ]);

  return gitStatusQuery;
}
