import type { ReactNode } from "react";
import { GitPullRequest } from "#product/primitives/icons/workspace-git";
import { CircleAlert } from "#product/primitives/icons/status";
import { Tooltip } from "#product/primitives/Tooltip";
import { prStatusCompoundLabel } from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type {
  WorkspaceGitAttention,
  WorkspaceGitStatus,
} from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

interface SidebarWorkspaceGitGlyphProps {
  status: WorkspaceGitStatus | null;
  /** Workspace identity to use when there is no real pull request. */
  fallbackIdentity?: ReactNode;
}

/**
 * Stable PR identity for the sidebar's trailing area. Every row keeps the PR
 * glyph in place when a PR exists; callers may provide the workspace identity
 * that replaces the dim no-PR glyph. Git attention stays a separate orange
 * alert so falling back does not hide an actionable git condition.
 */
export function SidebarWorkspaceGitGlyph({
  status,
  fallbackIdentity = null,
}: SidebarWorkspaceGitGlyphProps) {
  const hasPullRequest = Boolean(status?.pr && status.pr.state !== "none");
  const pullRequestLabel = hasPullRequest
    ? prStatusCompoundLabel(status) ?? "Pull request"
    : status?.pr?.state === "none"
      ? "No pull request"
      : "Pull request status unavailable";
  const attentionLabel = gitAttentionLabel(status?.attention ?? "none");
  const pullRequestIdentity = (
    <Tooltip content={pullRequestLabel} className="inline-flex items-center justify-center">
      <span role="img" aria-label={pullRequestLabel}>
        <GitPullRequest
          className={`icon-indicator [font-size:var(--text-sidebar-row)] ${hasPullRequest
            ? "text-sidebar-status-worktree"
            : "text-sidebar-muted-foreground/60"
          }`}
        />
      </span>
    </Tooltip>
  );
  const identity = hasPullRequest
    ? pullRequestIdentity
    : (fallbackIdentity ?? pullRequestIdentity);

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {identity}
      {attentionLabel ? (
        <Tooltip content={attentionLabel} className="inline-flex items-center justify-center">
          <span role="img" aria-label={attentionLabel}>
            <CircleAlert className="icon-indicator text-sidebar-status-waiting [font-size:var(--text-sidebar-row)]" />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function gitAttentionLabel(attention: WorkspaceGitAttention): string | null {
  switch (attention) {
    case "conflicts":
      return "Merge conflicts in worktree";
    case "ci_failing":
      return "Pull request checks failing";
    case "changes_requested":
      return "Pull request changes requested";
    case "none":
      return null;
  }
}
