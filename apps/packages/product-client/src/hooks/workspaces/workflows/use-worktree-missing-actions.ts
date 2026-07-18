import { useCallback, useState } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import { useRestoreWorktreeWorkspaceMutation } from "@anyharness/sdk-react";
import { worktreeRestoreFailureCopy } from "#product/copy/workspaces/workspace-availability-copy";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useWorkspaceRetireActions } from "#product/hooks/workspaces/workflows/use-workspace-retire-actions";
import { workspaceRetireBlockedMessage } from "#product/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

// Actions for the missing-worktree composer panel. "Check again" refetches
// the workspace collections; the runtime recomputes availability from disk on
// read, so the panel clears on its own once the directory is back.
export function useWorktreeMissingActions(args: {
  workspaceId: string;
  logicalWorkspaceId: string | null;
}) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const refresh = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const { markDone } = useWorkspaceRetireActions();
  const restoreMutation = useRestoreWorktreeWorkspaceMutation();
  const showToast = useToastStore((state) => state.show);
  const [isCheckingAgain, setIsCheckingAgain] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const checkAgain = useCallback(async () => {
    setRestoreError(null);
    setIsCheckingAgain(true);
    try {
      await refresh();
    } finally {
      setIsCheckingAgain(false);
    }
  }, [refresh]);

  const restoreWorktree = useCallback(async (): Promise<boolean> => {
    setRestoreError(null);
    try {
      await restoreMutation.mutateAsync(args.workspaceId);
      await refresh();
      showToast("Worktree restored.");
      return true;
    } catch (error) {
      setRestoreError(
        error instanceof AnyHarnessError
          ? worktreeRestoreFailureCopy(error.problem.code, error.problem.detail)
          : worktreeRestoreFailureCopy(null),
      );
      return false;
    }
  }, [args.workspaceId, refresh, restoreMutation, showToast]);

  const deleteWorkspace = useCallback(async (): Promise<boolean> => {
    setIsDeleting(true);
    try {
      const result = await markDone(args.workspaceId, {
        logicalWorkspaceId: args.logicalWorkspaceId,
      });
      if (result.outcome === "blocked") {
        showToast(workspaceRetireBlockedMessage(result));
        return false;
      }
      if (result.outcome === "cleanup_failed") {
        showToast("Workspace delete started, but cleanup needs attention.");
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to delete workspace: ${message}`);
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [args.logicalWorkspaceId, args.workspaceId, markDone, showToast]);

  return {
    checkAgain,
    isCheckingAgain,
    restoreWorktree,
    isRestoring: restoreMutation.isPending,
    restoreError,
    deleteWorkspace,
    isDeleting,
  };
}
