import { useCallback, useState } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import { useRestoreWorktreeWorkspaceMutation } from "@anyharness/sdk-react";
import {
  missingCheckoutStillMissingCopy,
  worktreeRestoreFailureCopy,
} from "#product/copy/workspaces/workspace-availability-copy";
import { isWorkspaceDirectoryMissing } from "#product/lib/domain/workspaces/availability";
import { useLatestWorkspaceCollectionsRead } from "#product/hooks/workspaces/cache/use-workspace-collections-cache";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

// Actions for the missing-worktree composer takeover. "Check again" refetches
// the workspace collections; the runtime recomputes availability from disk on
// read, so the takeover clears on its own once the directory is back.
export function useWorktreeMissingActions(args: { workspaceId: string }) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const readLatestCollections = useLatestWorkspaceCollectionsRead(runtimeUrl);
  const refresh = useWorkspaceCollectionsInvalidation(runtimeUrl);
  const restoreMutation = useRestoreWorktreeWorkspaceMutation();
  const showToast = useToastStore((state) => state.show);
  const [isCheckingAgain, setIsCheckingAgain] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const checkAgain = useCallback(async () => {
    setRestoreError(null);
    setIsCheckingAgain(true);
    try {
      await refresh();
    } finally {
      setIsCheckingAgain(false);
    }
    // A still-missing result leaves the takeover exactly as it was, which
    // reads as the button doing nothing — say so.
    const workspace = readLatestCollections()
      ?.allWorkspaces.find((candidate) => candidate.id === args.workspaceId);
    if (workspace && isWorkspaceDirectoryMissing(workspace)) {
      showToast(missingCheckoutStillMissingCopy(workspace.kind));
    }
  }, [args.workspaceId, readLatestCollections, refresh, showToast]);

  const restoreWorktree = useCallback(async (): Promise<boolean> => {
    setRestoreError(null);
    try {
      await restoreMutation.mutateAsync(args.workspaceId);
      // The SDK mutation refreshes raw AnyHarness queries. This separate key
      // owns the product-composed workspace collection that drives the panel.
      await refresh();
      // The store's show() defaults to the error tone; this one is a success.
      showToast("Worktree restored.", "info");
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

  return {
    checkAgain,
    isCheckingAgain,
    restoreWorktree,
    isRestoring: restoreMutation.isPending,
    restoreError,
  };
}
