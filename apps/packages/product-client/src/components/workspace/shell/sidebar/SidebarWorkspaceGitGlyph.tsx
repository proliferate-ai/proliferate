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
}

/**
 * Stable PR identity for the sidebar's trailing area. Every row keeps the PR
 * glyph in place: purple when a PR exists, dim when it does not or status is
 * unavailable. Git attention is a separate orange alert so it does not mutate
 * or replace the row's PR identity.
 */
export function SidebarWorkspaceGitGlyph({ status }: SidebarWorkspaceGitGlyphProps) {
  const hasPullRequest = Boolean(status?.pr && status.pr.state !== "none");
  const pullRequestLabel = hasPullRequest
    ? prStatusCompoundLabel(status) ?? "Pull request"
    : status?.pr?.state === "none"
      ? "No pull request"
      : "Pull request status unavailable";
  const attentionLabel = gitAttentionLabel(status?.attention ?? "none");
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
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
