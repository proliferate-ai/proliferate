import { PrBranchGlyph, PrMergedGlyph } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { SidebarGitGlyph } from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { PrStatusView } from "@proliferate/product-ui/patterns/PrStatusBadge";

interface SidebarWorkspaceGitGlyphProps {
  glyph: SidebarGitGlyph;
  status: PrStatusView;
}

/**
 * PR identity for the sidebar's left trailing cell. Every live PR uses the
 * branch glyph plus a status dot; merged PRs use the merge glyph without a dot.
 */
export function SidebarWorkspaceGitGlyph({ glyph, status }: SidebarWorkspaceGitGlyphProps) {
  const prDotColorClassName = resolvePrDotColorClassName(glyph, status);

  const icon = (
    <span role="img" aria-label={glyph.tooltip ?? "Pull request"}>
      {status.kind === "merged" ? (
        <PrMergedGlyph className="icon-indicator text-sidebar-muted-foreground [font-size:var(--text-sidebar-row)]" />
      ) : (
        <PrBranchGlyph
          dot
          className={`icon-indicator text-sidebar-muted-foreground [font-size:var(--text-sidebar-row)] ${prDotColorClassName}`}
        />
      )}
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

function resolvePrDotColorClassName(
  glyph: SidebarGitGlyph,
  status: PrStatusView,
): string {
  if (glyph.conflicted) {
    return "[--pr-status-dot-color:var(--color-sidebar-status-waiting)]";
  }
  switch (status.kind) {
    case "checks_failing":
    case "closed":
      return "[--pr-status-dot-color:var(--color-sidebar-status-error)]";
    case "pending":
    case "changes_requested":
    case "draft":
      return "[--pr-status-dot-color:var(--color-sidebar-status-waiting)]";
    case "open":
    case "merged":
      return "[--pr-status-dot-color:var(--color-success)]";
  }
}
