import type { ReactNode } from "react";
import { Fork } from "#product/primitives/icons/core";
import { CloudIcon } from "#product/primitives/icons/platform";
import {
  GitBranchIcon,
  GitBranchStatusIcon,
  type GitBranchStatusDotFill,
} from "#product/primitives/icons/workspace-git";
import { statusDotToneTextClass, type StatusDotTone } from "#product/primitives/StatusDot";
import { Tooltip } from "#product/primitives/Tooltip";
import {
  prStatusCompoundLabel,
  prStatusTone,
  prStatusViewFromGitStatus,
} from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

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

const IDENTITY_GLYPH_CLASS = "icon-indicator [font-size:var(--text-sidebar-row)]";

const WORKTREE_LABEL = "Worktree · no pull request";
const CLOUD_LABEL = "Cloud workspace · no pull request";

/**
 * Resolves the ONE identity a workspace row's trailing cell shows.
 *
 * A PR wins whenever the branch has one, because it is the strongest thing
 * true about the row; without a PR the cell falls back to the workspace's own
 * topology (worktree / cloud). Local and SSH rows resolve to null: a local
 * checkout with no PR has no git identity worth a permanent glyph, and the
 * dim always-on placeholder that used to fill this cell is what made the
 * column read as noise.
 *
 * Exported so the row can decide whether the identity cell exists at all
 * before rendering into it.
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
    case "ssh":
      return null;
  }
}

interface SidebarWorkspaceGitGlyphProps {
  status: WorkspaceGitStatus | null;
  variant: SidebarWorkspaceVariant;
}

/**
 * The workspace row's single trailing git-identity glyph.
 *
 * Git attention is NOT rendered here. Failing checks and requested changes
 * are already the state dot's colour, so repeating them beside the glyph
 * said the same thing twice; merge conflicts are an activity-style alert and
 * live in the row's status cell instead.
 */
export function SidebarWorkspaceGitGlyph({ status, variant }: SidebarWorkspaceGitGlyphProps) {
  const identity = resolveSidebarWorkspaceGitIdentity(status, variant);
  if (!identity) {
    return null;
  }

  switch (identity.kind) {
    case "merged_pull_request":
      return (
        <IdentityGlyph label={identity.label}>
          <GitBranchIcon className={`${IDENTITY_GLYPH_CLASS} text-sidebar-status-worktree`} />
        </IdentityGlyph>
      );
    case "pull_request":
      return (
        <IdentityGlyph label={identity.label}>
          <GitBranchStatusIcon
            className={`${IDENTITY_GLYPH_CLASS} text-sidebar-muted-foreground`}
            dotClassName={statusDotToneTextClass(identity.tone)}
            dotFill={identity.fill}
          />
        </IdentityGlyph>
      );
    case "worktree":
      return (
        <IdentityGlyph label={WORKTREE_LABEL}>
          {/* Horizontal fork: the branch-off reading, rhyming with the
              Workflows nav glyph rather than inventing a second one. */}
          <Fork className={`${IDENTITY_GLYPH_CLASS} rotate-90 text-sidebar-muted-foreground`} />
        </IdentityGlyph>
      );
    case "cloud":
      return (
        <IdentityGlyph label={CLOUD_LABEL}>
          <CloudIcon className={`${IDENTITY_GLYPH_CLASS} text-sidebar-muted-foreground`} />
        </IdentityGlyph>
      );
  }
}

function IdentityGlyph({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip content={label} className="inline-flex items-center justify-center">
      <span role="img" aria-label={label} className="inline-flex items-center justify-center">
        {children}
      </span>
    </Tooltip>
  );
}
