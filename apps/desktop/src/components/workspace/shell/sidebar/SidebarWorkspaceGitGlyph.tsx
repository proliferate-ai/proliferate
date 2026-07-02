import { GitBranch, GitPullRequest } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { SidebarGitGlyph } from "@/lib/domain/workspaces/git-status/pr-status-presentation";

interface SidebarWorkspaceGitGlyphProps {
  glyph: SidebarGitGlyph;
}

/**
 * Leading-well git glyph for idle sidebar rows (§3.2): the PR icon (decorated
 * with the status dot by the row) or the plain branch icon, rendered in the
 * destructive tone when the worktree has merge conflicts. Wraps the icon in a
 * tooltip when the glyph carries one.
 */
export function SidebarWorkspaceGitGlyph({ glyph }: SidebarWorkspaceGitGlyphProps) {
  const Icon = glyph.kind === "pull_request" ? GitPullRequest : GitBranch;
  const icon = (
    <Icon
      className={`size-3.5 ${glyph.conflicted ? "text-destructive" : "text-sidebar-muted-foreground"}`}
    />
  );

  if (!glyph.tooltip) {
    return icon;
  }

  return (
    <Tooltip
      content={glyph.tooltip}
      className="inline-flex shrink-0 items-center justify-center"
    >
      {icon}
    </Tooltip>
  );
}
