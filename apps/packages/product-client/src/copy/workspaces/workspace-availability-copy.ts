import type { Workspace } from "@anyharness/sdk";

export interface MissingCheckoutCopy {
  /** Panel header + sidebar tooltip. */
  title: string;
  /** Panel body, default (non-confirming) state. */
  body: string;
  /** Send-button tooltip and session-creation block reason. */
  sendBlockedReason: string;
  /** Panel body while the inline delete confirmation is showing. */
  deleteConfirmBody: string;
}

export function worktreeRestoreFailureCopy(
  code: string | null | undefined,
  fallbackDetail?: string | null,
): string {
  switch (code) {
    case "WORKTREE_RESTORE_REPOSITORY_MISSING":
      return "The source repository is no longer available at its recorded location. Restore or reconnect that repository, then try again.";
    case "WORKTREE_RESTORE_BRANCH_MISSING":
      return "The recorded branch no longer exists in the source repository. Recreate that branch before restoring this worktree.";
    case "WORKTREE_RESTORE_PARENT_UNAVAILABLE":
      return "The parent folder for the recorded worktree path is unavailable. Recreate or reconnect that folder, then try again.";
    case "WORKTREE_RESTORE_PATH_OCCUPIED":
      return "Something now exists at the recorded worktree path. Move it elsewhere, then check again; Proliferate will not overwrite it.";
    case "WORKTREE_RESTORE_REGISTRATION_CONFLICT":
      return "Another workspace or Git worktree registration conflicts with this path. Resolve that registration before trying again.";
    case "WORKTREE_RESTORE_BRANCH_CHECKED_OUT":
      return "The recorded branch is checked out in another worktree. Close or remove that checkout before restoring this one.";
    case "WORKTREE_RESTORE_GIT_AMBIGUOUS":
      return "Git's worktree metadata is ambiguous, so restoration stopped safely. Resolve the conflicting or locked registration, then try again.";
    case "WORKTREE_RESTORE_INELIGIBLE":
      return "This workspace no longer has enough recorded repository and branch information to restore its worktree safely.";
    case "WORKSPACE_NOT_FOUND":
      return "This workspace no longer exists in the runtime. Refresh the workspace list before trying again.";
    case "WORKSPACE_RETIRED":
      return "This workspace is no longer active and cannot restore a worktree.";
    default:
      return fallbackDetail?.trim()
        || "The worktree could not be restored safely. Nothing at the recorded path was overwritten or removed.";
  }
}

// The runtime reports workspace_directory_missing for both worktree and plain
// local checkouts; the words must follow the workspace kind — "worktree" is
// wrong terminology for a deleted local clone.
export function missingCheckoutCopy(kind: Workspace["kind"]): MissingCheckoutCopy {
  const noun = kind === "worktree" ? "Worktree" : "Workspace folder";
  return {
    title: `${noun} no longer exists`,
    body: kind === "worktree"
      ? "The local worktree was removed. Restore recreates committed files from the recorded branch; deleted uncommitted changes cannot be recovered. Your existing chat history stays attached to this workspace."
      : "The local checkout for this workspace was removed. Your chat history is still available, but agents, files, and terminals can't run here.",
    sendBlockedReason: `${noun} no longer exists. Agents can't run in this workspace.`,
    deleteConfirmBody:
      "Delete this workspace? Its record and chat history are removed permanently. This cannot be undone.",
  };
}
