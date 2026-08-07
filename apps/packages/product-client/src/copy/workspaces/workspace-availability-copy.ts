import type { Workspace } from "@anyharness/sdk";

export interface MissingCheckoutCopy {
  /** Sidebar tooltip. */
  title: string;
  /** Send-button tooltip and session-creation block reason. */
  sendBlockedReason: string;
}

export function worktreeRestoreFailureCopy(
  code: string | null | undefined,
  fallbackDetail?: string | null,
): string {
  switch (code) {
    case "WORKTREE_RESTORE_REPOSITORY_RECORD_MISSING":
      return "This workspace's source repository is no longer registered in Proliferate. Reconnect that repository, refresh the workspace list, then try again.";
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
      return "This workspace no longer has an attached current branch and cannot be restored safely. Detached worktrees must be recreated explicitly.";
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
    sendBlockedReason: `${noun} no longer exists. Agents can't run in this workspace.`,
  };
}

// Composer-takeover status line (Blocked Status design): one sentence, no em
// dashes. "Restore" only reads correctly when a restore action is actually
// offered (worktree kind + eligible); otherwise the sentence points at
// "Check again" instead, since there is no restore mutation for a plain
// local checkout.
export function missingCheckoutComposerMessage(
  kind: Workspace["kind"],
  restoreEligible: boolean,
): string {
  const noun = kind === "worktree" ? "Worktree folder" : "Workspace folder";
  return restoreEligible
    ? `${noun} is missing. Chat is paused until it’s restored.`
    : `${noun} is missing. Chat is paused until it’s back on disk.`;
}
