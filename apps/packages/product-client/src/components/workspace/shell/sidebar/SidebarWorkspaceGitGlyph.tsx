import { PrBranchGlyph, PrMergedGlyph } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { SidebarGitGlyph } from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { PrStatusView } from "@proliferate/product-ui/patterns/PrStatusBadge";

interface SidebarWorkspaceGitGlyphProps {
  glyph: SidebarGitGlyph;
  status: PrStatusView;
}

/**
 * Compact git/PR glyph for the sidebar detail cluster: three visual states
 * only. Merged gets its own purple merge glyph; a PR with a problem
 * (failing checks, closed, conflicts) is the muted branch glyph with a red
 * dot baked into the SVG; every other real PR is the plain muted branch
 * glyph. Finer states (draft/pending/review) live in the tooltip,
 * not in color.
 *
 * Tier: `icon-tight` (0.875em), the sidebar's small-glyph tier — the same one
 * the row's own trailing controls already draw at (SidebarActionButton and the
 * workspace kebab both pin `[&_svg]:icon-tight`). This glyph is metadata about
 * the row, so it sits one tier BELOW the row's text: the workspace name leads
 * and the PR state is read second. At `icon-paired` (1.230769em) it drew larger
 * than both the name and the controls beside it, which is what made the
 * trailing cluster shout. Em-relative against `--text-sidebar-row` so it tracks
 * the UI font-size setting instead of pinning a pixel size.
 */
export function SidebarWorkspaceGitGlyph({ glyph, status }: SidebarWorkspaceGitGlyphProps) {
  const hasIssue = glyph.conflicted
    || status.kind === "checks_failing"
    || status.kind === "closed";

  const icon = (
    <span role="img" aria-label={glyph.tooltip ?? "Pull request"}>
      {status.kind === "merged" ? (
        <PrMergedGlyph className="icon-tight text-pr-merged [font-size:var(--text-sidebar-row)]" />
      ) : (
        <PrBranchGlyph
          dot={hasIssue}
          className="icon-tight text-sidebar-muted-foreground [--pr-status-dot-color:var(--color-destructive)] [font-size:var(--text-sidebar-row)]"
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
