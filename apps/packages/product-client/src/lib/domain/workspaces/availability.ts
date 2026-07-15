import type { Workspace } from "@anyharness/sdk";

/**
 * User-facing copy for the missing-worktree condition. Deliberately free of
 * internal terms (ACP, session start): this is a persistent workspace state,
 * not an operation failure.
 */
export const WORKTREE_MISSING_TITLE = "Worktree no longer exists";
export const WORKTREE_MISSING_SEND_BLOCKED_REASON =
  "Worktree no longer exists. Agents can't run in this workspace.";

export function isWorkspaceDirectoryMissing(
  workspace: Pick<Workspace, "availability"> | null | undefined,
): boolean {
  return workspace?.availability === "workspace_directory_missing";
}
