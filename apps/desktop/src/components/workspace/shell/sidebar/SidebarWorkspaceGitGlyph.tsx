import { GitPullRequest } from "@proliferate/ui/icons";

/**
 * Leading-well PR glyph for sidebar rows (§3.2): a 14px `GitPullRequest` icon
 * rendered only for rows with a real PR (gated by the parent). Color is applied
 * directly on the SVG via the `colorClass` prop (e.g. "text-success") to
 * guarantee the stroke reaches the SVG stroke="currentColor" attribute without
 * depending on CSS `color` inheritance through wrapper spans — WKWebView can
 * drop inherited color across inline-flex boundaries. Tooltip/aria is handled
 * by the `PrStatusIconOverlay` wrapper.
 */
export function SidebarWorkspaceGitGlyph({ colorClass }: { colorClass?: string }) {
  return <GitPullRequest className={`size-3.5 ${colorClass ?? "text-sidebar-muted-foreground"}`} />;
}
