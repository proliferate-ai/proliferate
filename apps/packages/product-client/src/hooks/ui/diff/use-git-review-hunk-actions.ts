import { useCallback } from "react";
import {
  useRevertGitPatchesMutation,
  useStagePatchMutation,
  useUnstagePatchMutation,
} from "@anyharness/sdk-react";
import { extractHunkPatch, isHunkActionEligible } from "#product/lib/domain/files/hunk-patch";
import type { GitPanelReviewScope } from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { useToastStore } from "#product/stores/toast/toast-store";

/** Structurally matches the diff viewers' `UnifiedDiffHunkActions` prop (hooks cannot import component types). */
export interface GitReviewHunkActions {
  mode: "staged" | "unstaged";
  disabled: boolean;
  onRevert: (hunkIndex: number) => void;
  onStageOrUnstage: (hunkIndex: number) => void;
}

/**
 * Hunk-level actions for a git review row: only for working-tree scopes
 * (unstaged/staged) in unified layout, and only when the patch is complete and
 * the file is not binary/rename/copy. Branch and last-turn diffs are excluded —
 * their hunks are not guaranteed to apply against the current worktree/index.
 */
export function useGitReviewHunkActions({
  workspaceId,
  sectionScope,
  path,
  oldPath,
  patch,
  layout,
  diffTruncated,
  isRuntimeReady,
}: {
  workspaceId: string | null;
  sectionScope: GitPanelReviewScope;
  path: string;
  oldPath: string | null;
  patch: string | null;
  layout: "unified" | "split";
  diffTruncated: boolean;
  isRuntimeReady: boolean;
}): GitReviewHunkActions | null {
  const shouldUnstage = sectionScope === "staged";
  // Lightweight mutation hooks — share the same query client.
  const revertMutation = useRevertGitPatchesMutation({ workspaceId });
  const stagePatchMutation = useStagePatchMutation({ workspaceId });
  const unstagePatchMutation = useUnstagePatchMutation({ workspaceId });
  const showToast = useToastStore((state) => state.show);
  const hunkMutationInFlight =
    revertMutation.isPending || stagePatchMutation.isPending || unstagePatchMutation.isPending;

  const handleHunkRevert = useCallback(
    (hunkIndex: number) => {
      if (!patch) return;
      const result = extractHunkPatch({ patch, hunkIndex, filePath: path, oldPath });
      if (result) {
        revertMutation
          .mutateAsync({
            entries: [{
              path,
              operation: "edit",
              patch: result.patch,
            }],
          })
          .catch((error: unknown) => {
            showToast(formatHunkActionError(error, "Could not revert this change."));
          });
      }
    },
    [patch, path, oldPath, revertMutation, showToast],
  );

  const handleHunkStageOrUnstage = useCallback(
    (hunkIndex: number) => {
      if (!patch) return;
      const result = extractHunkPatch({ patch, hunkIndex, filePath: path, oldPath });
      if (!result) return;
      if (shouldUnstage) {
        unstagePatchMutation.mutateAsync(result.patch).catch((error: unknown) => {
          showToast(formatHunkActionError(error, "Could not unstage this change."));
        });
      } else {
        stagePatchMutation.mutateAsync(result.patch).catch((error: unknown) => {
          showToast(formatHunkActionError(error, "Could not stage this change."));
        });
      }
    },
    [patch, path, oldPath, shouldUnstage, stagePatchMutation, unstagePatchMutation, showToast],
  );

  const enabled = Boolean(
    patch
    && sectionScope !== "branch"
    && sectionScope !== "last_turn"
    && layout === "unified"
    && !diffTruncated
    && isHunkActionEligible(patch, oldPath)
    && isRuntimeReady,
  );

  return enabled
    ? {
        mode: shouldUnstage ? "staged" : "unstaged",
        disabled: !isRuntimeReady || hunkMutationInFlight,
        onRevert: handleHunkRevert,
        onStageOrUnstage: handleHunkStageOrUnstage,
      }
    : null;
}

function formatHunkActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
