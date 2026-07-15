import { useCallback, useState } from "react";
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
  const showToast = useToastStore((state) => state.show);
  const [isCheckingAgain, setIsCheckingAgain] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const checkAgain = useCallback(async () => {
    setIsCheckingAgain(true);
    try {
      await refresh();
    } finally {
      setIsCheckingAgain(false);
    }
  }, [refresh]);

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
    deleteWorkspace,
    isDeleting,
  };
}
