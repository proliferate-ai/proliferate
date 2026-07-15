import { PrBranchGlyph, PrMergedGlyph } from "@proliferate/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { SidebarGitGlyph } from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { PrStatusView } from "@proliferate/product-ui/workspaces/PrStatusBadge";

interface SidebarWorkspaceGitGlyphProps {
  glyph: SidebarGitGlyph;
  status: PrStatusView;
}

/**
 * Compact git/PR glyph for the sidebar detail cluster, codex-style: three
 * visual states only. Merged gets its own purple merge glyph; a PR with a
 * problem (failing checks, closed, conflicts) is the muted branch glyph with
 * a red dot baked into the SVG; every other real PR is the plain muted
 * branch glyph. Finer states (draft/pending/review) live in the tooltip,
 * not in color.
 */
export function SidebarWorkspaceGitGlyph({ glyph, status }: SidebarWorkspaceGitGlyphProps) {
  const hasIssue = glyph.conflicted
    || status.kind === "checks_failing"
    || status.kind === "closed";

  const icon = (
    <span role="img" aria-label={glyph.tooltip ?? "Pull request"}>
      {status.kind === "merged" ? (
        <PrMergedGlyph className="size-3.5 text-pr-merged" />
      ) : (
        <PrBranchGlyph
          dot={hasIssue}
          className="size-3.5 text-sidebar-muted-foreground [--pr-status-dot-color:var(--color-destructive)]"
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
