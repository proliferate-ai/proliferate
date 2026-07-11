import { GitBranchIcon } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { SidebarGitGlyph } from "@/lib/domain/workspaces/git-status/pr-status-presentation";
import type { PrStatusView } from "@proliferate/product-ui/workspaces/PrStatusBadge";

interface SidebarWorkspaceGitGlyphProps {
  glyph: SidebarGitGlyph;
  status: PrStatusView;
}

/**
 * Compact git/PR glyph for the sidebar detail cluster. The branch shape
 * matches the Home target picker; status is expressed through the glyph tone
 * instead of adding a second dot on top of it.
 */
export function SidebarWorkspaceGitGlyph({ glyph, status }: SidebarWorkspaceGitGlyphProps) {
  const icon = (
    <span role="img" aria-label={glyph.tooltip ?? "Pull request"}>
      <GitBranchIcon
        className={`size-3.5 ${glyph.conflicted ? "text-destructive" : gitStatusTone(status.kind)}`}
      />
    </span>
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

function gitStatusTone(kind: PrStatusView["kind"]): string {
  switch (kind) {
    case "open":
      return "text-success";
    case "merged":
      return "text-pr-merged";
    case "pending":
    case "changes_requested":
      return "text-warning";
    case "checks_failing":
    case "closed":
      return "text-destructive";
    case "draft":
    default:
      return "text-sidebar-muted-foreground";
  }
}
