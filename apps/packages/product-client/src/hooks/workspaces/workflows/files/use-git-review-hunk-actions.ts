import { useCallback } from "react";
import {
  useRevertGitPatchesMutation,
  useStagePatchMutation,
  useUnstagePatchMutation,
} from "@anyharness/sdk-react";
import {
  extractHunkPatch,
  isHunkActionEligible,
  type UnifiedDiffHunkActions,
} from "#product/lib/domain/files/hunk-patch";
import type {
  GitPanelReviewFile,
  GitPanelReviewScope,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { useToastStore } from "#product/stores/toast/toast-store";

export function useGitReviewHunkActions({
  workspaceId,
  sectionScope,
  file,
  layout,
  patch,
  truncated,
  isRuntimeReady,
}: {
  workspaceId: string | null;
  sectionScope: GitPanelReviewScope;
  file: GitPanelReviewFile;
  layout: "unified" | "split";
  patch: string | null;
  truncated: boolean;
  isRuntimeReady: boolean;
}): UnifiedDiffHunkActions | null {
  const revertMutation = useRevertGitPatchesMutation({ workspaceId });
  const stagePatchMutation = useStagePatchMutation({ workspaceId });
  const unstagePatchMutation = useUnstagePatchMutation({ workspaceId });
  const showToast = useToastStore((state) => state.show);
  const shouldUnstage = sectionScope === "staged";
  const actionsEnabled = Boolean(
    patch
    && sectionScope !== "branch"
    && sectionScope !== "last_turn"
    && layout === "unified"
    && !truncated
    && isHunkActionEligible(patch, file.oldPath)
    && isRuntimeReady,
  );
  const mutationInFlight =
    revertMutation.isPending || stagePatchMutation.isPending || unstagePatchMutation.isPending;

  const handleRevert = useCallback((hunkIndex: number) => {
    if (!patch) return;
    const result = extractHunkPatch({
      patch,
      hunkIndex,
      filePath: file.path,
      oldPath: file.oldPath,
    });
    if (!result) return;
    revertMutation.mutateAsync({
      entries: [{ path: file.path, operation: "edit", patch: result.patch }],
    }).catch((error: unknown) => {
      showToast(formatHunkActionError(error, "Could not revert this change."));
    });
  }, [file.oldPath, file.path, patch, revertMutation, showToast]);

  const handleStageOrUnstage = useCallback((hunkIndex: number) => {
    if (!patch) return;
    const result = extractHunkPatch({
      patch,
      hunkIndex,
      filePath: file.path,
      oldPath: file.oldPath,
    });
    if (!result) return;
    const mutation = shouldUnstage ? unstagePatchMutation : stagePatchMutation;
    mutation.mutateAsync(result.patch).catch((error: unknown) => {
      showToast(formatHunkActionError(
        error,
        shouldUnstage ? "Could not unstage this change." : "Could not stage this change.",
      ));
    });
  }, [
    file.oldPath,
    file.path,
    patch,
    shouldUnstage,
    showToast,
    stagePatchMutation,
    unstagePatchMutation,
  ]);

  return actionsEnabled
    ? {
        mode: shouldUnstage ? "staged" : "unstaged",
        disabled: !isRuntimeReady || mutationInFlight,
        onRevert: handleRevert,
        onStageOrUnstage: handleStageOrUnstage,
      }
    : null;
}

function formatHunkActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
