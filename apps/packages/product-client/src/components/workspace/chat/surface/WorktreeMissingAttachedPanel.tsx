import { useState, type ReactNode } from "react";
import { CircleAlert } from "@proliferate/ui/icons";
import {
  ComposerAttachedPanel,
  ComposerCardFooter,
} from "#product/components/workspace/chat/input/ComposerAttachedPanel";
import { useWorktreeMissingActions } from "#product/hooks/workspaces/workflows/use-worktree-missing-actions";
import { WORKTREE_MISSING_TITLE } from "#product/lib/domain/workspaces/availability";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border/40 px-4 py-2">
      <span className="w-20 shrink-0 text-base font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-base text-muted-foreground">{children}</div>
    </div>
  );
}

/**
 * Persistent composer panel for a workspace whose local checkout was removed
 * from disk. Non-dismissible while the directory is missing: no collapse and
 * no close affordance — it clears when "Check again" (or the collections
 * refetch) sees the directory back, or when the workspace is deleted.
 */
export function WorktreeMissingAttachedPanel({
  workspaceId,
  logicalWorkspaceId,
  workspacePath,
  originalBranch,
}: {
  workspaceId: string;
  logicalWorkspaceId: string | null;
  workspacePath: string;
  originalBranch: string | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { checkAgain, isCheckingAgain, deleteWorkspace, isDeleting } =
    useWorktreeMissingActions({ workspaceId, logicalWorkspaceId });

  return (
    <ComposerAttachedPanel
      icon={<CircleAlert className="text-warning-foreground" />}
      title={WORKTREE_MISSING_TITLE}
    >
      <div className="px-3 pb-1 text-base text-muted-foreground">
        {confirmingDelete
          ? "Delete this workspace? Its record and chat history are removed permanently. This cannot be undone."
          : "The local checkout for this workspace was removed. Your chat history is still available, but agents, files, and terminals can't run here."}
      </div>
      {!confirmingDelete && showDetails && (
        <div className="pt-1">
          <DetailRow label="Path">
            <span className="truncate font-mono text-sm" title={workspacePath}>
              {workspacePath}
            </span>
          </DetailRow>
          {originalBranch && (
            <DetailRow label="Branch">
              <span className="truncate font-mono text-sm" title={originalBranch}>
                {originalBranch}
              </span>
            </DetailRow>
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
                void deleteWorkspace();
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
              {
                label: "Delete workspace…",
                onSelect: () => setConfirmingDelete(true),
              },
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
