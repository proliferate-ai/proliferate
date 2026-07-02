import { GitPullRequest } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { SidebarGitGlyph } from "@/lib/domain/workspaces/git-status/pr-status-presentation";

interface SidebarWorkspaceGitGlyphProps {
  glyph: SidebarGitGlyph;
}

/**
 * Leading-well PR glyph for sidebar rows (§3.2): rendered only for rows with
 * a real PR (the glyph is null otherwise — no branch fallback), decorated
 * with the status dot by the row, and drawn in the destructive tone when the
 * worktree has merge conflicts. Wraps the icon in a tooltip when the glyph
 * carries one.
 */
export function SidebarWorkspaceGitGlyph({ glyph }: SidebarWorkspaceGitGlyphProps) {
  const icon = (
    <GitPullRequest
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
