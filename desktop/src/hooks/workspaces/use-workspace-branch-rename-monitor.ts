import { useEffect } from "react";
import { useGitStatusQuery } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { resolveSessionViewState } from "@/lib/domain/sessions/activity";
import { updateCloudWorkspaceBranch } from "@/lib/integrations/cloud/workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useBranchRenameStore } from "@/stores/workspaces/branch-rename-store";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";

const BRANCH_RENAME_POLL_INTERVAL_MS = 250;
const BRANCH_RENAME_TIMEOUT_MS = 60_000;

export function useWorkspaceBranchRenameMonitor() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const activeSession = useHarnessStore((state) => (
    state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null
  ));
  const pendingRename = useBranchRenameStore((state) => (
    selectedWorkspaceId ? state.pendingByWorkspaceId[selectedWorkspaceId] ?? null : null
  ));
  const clearPendingRename = useBranchRenameStore((state) => state.clearPendingRename);
  const isRuntimeReadyForWorkspace =
    selectedCloudRuntime.workspaceId !== selectedWorkspaceId
    || selectedCloudRuntime.state?.phase === "ready";

  const shouldPoll = !!selectedWorkspaceId
    && !!pendingRename
    && activeSession?.workspaceId === selectedWorkspaceId
    && isRuntimeReadyForWorkspace
    && resolveSessionViewState(activeSession) === "working";

  const gitStatusQuery = useGitStatusQuery({
    enabled: !!selectedWorkspaceId && isRuntimeReadyForWorkspace,
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
    if (!pendingRename || !currentBranch || currentBranch === pendingRename.placeholderBranch) {
      return;
    }

    const completedRename = pendingRename;

    void (async () => {
      try {
        if (completedRename.cloudWorkspaceId) {
          await updateCloudWorkspaceBranch(completedRename.cloudWorkspaceId, currentBranch);
        }
        await queryClient.invalidateQueries({
          queryKey: workspaceCollectionsScopeKey(runtimeUrl),
        });
      } finally {
        clearPendingRename(completedRename.workspaceId);
      }
    })();
  }, [clearPendingRename, gitStatusQuery.data?.currentBranch, pendingRename, queryClient, runtimeUrl]);

  return gitStatusQuery;
}
