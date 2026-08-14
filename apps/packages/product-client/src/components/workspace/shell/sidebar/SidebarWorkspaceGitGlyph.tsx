import type { ReactNode } from "react";
import { Fork } from "#product/primitives/icons/core";
import { CloudIcon } from "#product/primitives/icons/platform";
import { GitBranchIcon, GitBranchStatusIcon } from "#product/primitives/icons/workspace-git";
import { statusDotToneTextClass } from "#product/primitives/StatusDot";
import { Tooltip } from "#product/primitives/Tooltip";
import {
  SIDEBAR_GIT_IDENTITY_CLOUD_LABEL,
  SIDEBAR_GIT_IDENTITY_WORKTREE_LABEL,
  type SidebarWorkspaceGitIdentity,
} from "#product/lib/domain/workspaces/git-status/sidebar-git-identity";

const IDENTITY_GLYPH_CLASS = "icon-indicator [font-size:var(--text-sidebar-row)]";

interface SidebarWorkspaceGitGlyphProps {
  identity: SidebarWorkspaceGitIdentity;
}

/**
 * The workspace row's single trailing git-identity glyph.
 *
 * Takes the already-resolved identity rather than the raw status: the row
 * needs the same answer to decide whether the cell exists at all, and
 * resolving it a second time here invited the two to disagree.
 *
 * Git attention is NOT rendered here. Failing checks and requested changes
 * are already the state dot's colour on an open PR, so repeating them beside
 * the glyph said the same thing twice; the attention the dot cannot carry is
 * an alert in the row's status cell instead.
 */
export function SidebarWorkspaceGitGlyph({ identity }: SidebarWorkspaceGitGlyphProps) {
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
        <IdentityGlyph label={SIDEBAR_GIT_IDENTITY_WORKTREE_LABEL}>
          {/* Horizontal fork: the branch-off reading, rhyming with the
              Workflows nav glyph rather than inventing a second one. */}
          <Fork className={`${IDENTITY_GLYPH_CLASS} rotate-90 text-sidebar-muted-foreground`} />
        </IdentityGlyph>
      );
    case "cloud":
      return (
        <IdentityGlyph label={SIDEBAR_GIT_IDENTITY_CLOUD_LABEL}>
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
