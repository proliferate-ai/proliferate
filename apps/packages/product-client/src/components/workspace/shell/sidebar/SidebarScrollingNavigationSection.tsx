import { useLocation } from "react-router-dom";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { SidebarScrollingNavigation } from "#product/components/workspace/shell/sidebar/SidebarPrimaryNavigation";
import { APP_ROUTES } from "#product/config/app-routes";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useOpenSupportReportWindow } from "#product/hooks/support/workflows/use-open-support-report-window";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import { useShortcutRevealVisible } from "#product/providers/ShortcutRevealProvider";

// Platform cannot change at runtime, so the label is resolved once rather
// than on every render of the section.
const SUPPORT_SHORTCUT_LABEL = getShortcutDisplayLabel(SHORTCUTS.openSupport);

interface SidebarScrollingNavigationSectionProps {
  onGoWorkspaces: () => void;
  onGoWorkflows: () => void;
}

/**
 * The destination rows that scroll with the repository list, and the wiring
 * only they need.
 *
 * Route matching, the support-window opener and the Support shortcut label
 * were the sidebar host's to hold while these rows rendered from it; they
 * belong with the rows instead, so `MainSidebar` stays the composition point
 * rather than the wiring point.
 */
export function SidebarScrollingNavigationSection({
  onGoWorkspaces,
  onGoWorkflows,
}: SidebarScrollingNavigationSectionProps) {
  const location = useLocation();
  const shortcutRevealVisible = useShortcutRevealVisible();
  const { openBug: handleOpenSupport } = useOpenSupportReportWindow({ source: "sidebar" });

  return (
    // These rows kept profiler coverage while they rendered inside the pinned
    // nav's profiler; splitting the navigation must not silently drop them
    // out of the render-cost picture.
    <DebugProfiler id="workspace-sidebar-scrolling-nav">
      <SidebarScrollingNavigation
        workspacesActive={location.pathname === APP_ROUTES.workspaces}
        workflowsActive={location.pathname.startsWith(APP_ROUTES.workflows)}
        supportActive={false}
        onGoWorkspaces={onGoWorkspaces}
        onGoWorkflows={onGoWorkflows}
        onOpenSupport={handleOpenSupport}
        shortcutRevealVisible={shortcutRevealVisible}
        supportShortcutLabel={SUPPORT_SHORTCUT_LABEL}
      />
    </DebugProfiler>
  );
}
