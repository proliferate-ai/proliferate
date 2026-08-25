import type { GitBranchStatusDotFill } from "#product/primitives/icons/workspace-git";
import type { StatusDotTone } from "#product/primitives/StatusDot";
import {
  prStatusCompoundLabel,
  prStatusTone,
  prStatusViewFromGitStatus,
} from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";

/**
 * What the row's trailing identity cell says about a workspace. Exactly one
 * of these, or nothing at all — the cell is omitted rather than filled with a
 * placeholder, so a row that has no git identity to report stays quiet.
 */
export type SidebarWorkspaceGitIdentity =
  /** A live PR: branch glyph + the state dot. */
  | { kind: "pull_request"; tone: StatusDotTone; fill: GitBranchStatusDotFill; label: string }
  /** A settled PR reads as the whole glyph in the merged ink, with no dot. */
  | { kind: "merged_pull_request"; label: string }
  /** No PR — the cell falls back to what the workspace IS. */
  | { kind: "worktree" }
  | { kind: "cloud" };

export const SIDEBAR_GIT_IDENTITY_WORKTREE_LABEL = "Worktree · no pull request";
export const SIDEBAR_GIT_IDENTITY_CLOUD_LABEL = "Cloud workspace · no pull request";

/**
 * Resolves the ONE identity a workspace row's trailing cell shows.
 *
 * A PR wins whenever the branch has one, because it is the strongest thing
 * true about the row; without a PR the cell falls back to the workspace's own
 * topology (worktree / cloud). Local rows resolve to null: a local
 * checkout with no PR has no git identity worth a permanent glyph, and the
 * dim always-on placeholder that used to fill this cell is what made the
 * column read as noise.
 *
 * The row resolves this once and passes the result to both the cell's
 * existence check and the glyph, so the waterfall runs a single time.
 */
export function resolveSidebarWorkspaceGitIdentity(
  status: WorkspaceGitStatus | null,
  variant: SidebarWorkspaceVariant,
): SidebarWorkspaceGitIdentity | null {
  // Null for both "no PR on this branch" (authoritative) and "PR data
  // unknown" — neither is something to draw.
  const view = prStatusViewFromGitStatus(status);
  if (view) {
    const label = prStatusCompoundLabel(status) ?? "Pull request";
    if (view.kind === "merged") {
      return { kind: "merged_pull_request", label };
    }
    const { tone, fill } = prStatusTone(view.kind);
    return { kind: "pull_request", tone, fill, label };
  }

  switch (variant) {
    case "worktree":
      return { kind: "worktree" };
    case "cloud":
      return { kind: "cloud" };
    case "local":
      return null;
  }
}
