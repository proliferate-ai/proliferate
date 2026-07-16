import { useState } from "react";
import type { Workspace } from "@anyharness/sdk";
import { CircleAlert } from "@proliferate/ui/icons";
import {
  ComposerAttachedPanel,
  ComposerAttachedPanelRow,
  ComposerCardFooter,
} from "#product/components/workspace/chat/input/ComposerAttachedPanel";
import { useWorktreeMissingActions } from "#product/hooks/workspaces/workflows/use-worktree-missing-actions";
import { missingCheckoutCopy } from "#product/copy/workspaces/workspace-availability-copy";

/**
 * Persistent composer panel for a workspace whose local checkout was removed
 * from disk. Non-dismissible while the directory is missing: no collapse and
 * no close affordance — it clears when "Check again" (or the collections
 * refetch) sees the directory back, or when the workspace is deleted.
 */
export function WorktreeMissingAttachedPanel({
  workspaceId,
  logicalWorkspaceId,
  workspaceKind,
  workspacePath,
  originalBranch,
}: {
  workspaceId: string;
  logicalWorkspaceId: string | null;
  workspaceKind: Workspace["kind"];
  workspacePath: string;
  originalBranch: string | null;
}) {
  const copy = missingCheckoutCopy(workspaceKind);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { checkAgain, isCheckingAgain, deleteWorkspace, isDeleting } =
    useWorktreeMissingActions({ workspaceId, logicalWorkspaceId });
  // Purge is worktree-only server-side (retire preflight blocks other kinds),
  // so offering Delete for a plain local workspace would always dead-end in a
  // "blocked" toast.
  const canDelete = workspaceKind === "worktree";

  return (
    <ComposerAttachedPanel
      icon={<CircleAlert className="text-warning-foreground" />}
      title={copy.title}
    >
      <div className="px-3 pb-1 text-base text-muted-foreground">
        {confirmingDelete ? copy.deleteConfirmBody : copy.body}
      </div>
      {!confirmingDelete && showDetails && (
        <div className="pt-1">
          <ComposerAttachedPanelRow label="Path">
            <span
              className="block truncate font-mono text-sm text-muted-foreground"
              title={workspacePath}
            >
              {workspacePath}
            </span>
          </ComposerAttachedPanelRow>
          {originalBranch && (
            <ComposerAttachedPanelRow label="Branch">
              <span
                className="block truncate font-mono text-sm text-muted-foreground"
                title={originalBranch}
              >
                {originalBranch}
              </span>
            </ComposerAttachedPanelRow>
          )}
        </div>
      )}
      {confirmingDelete
        ? (
          <ComposerCardFooter
            secondaryActions={[
              {
                label: "Cancel",
                onSelect: () => setConfirmingDelete(false),
                disabled: isDeleting,
              },
            ]}
            primaryAction={{
              label: isDeleting ? "Deleting…" : "Delete workspace",
              onSelect: () => {
                void deleteWorkspace().then((deleted) => {
                  // On success the workspace (and this panel) unmounts; on a
                  // blocked or failed delete, drop back out of the confirm
                  // step so the failure toast isn't paired with a live
                  // destructive button.
                  if (!deleted) {
                    setConfirmingDelete(false);
                  }
                });
              },
              disabled: isDeleting,
            }}
          />
        )
        : (
          <ComposerCardFooter
            secondaryActions={[
              {
                label: isCheckingAgain ? "Checking…" : "Check again",
                onSelect: () => {
                  void checkAgain();
                },
                disabled: isCheckingAgain,
              },
              ...(canDelete
                ? [{
                  label: "Delete workspace…",
                  onSelect: () => setConfirmingDelete(true),
                }]
                : []),
              {
                label: showDetails ? "Hide details" : "Show details",
                onSelect: () => setShowDetails((value) => !value),
              },
            ]}
          />
        )}
    </ComposerAttachedPanel>
  );
}
