import { useLocation } from "react-router-dom";
import { SidebarScrollingNavigation } from "#product/components/workspace/shell/sidebar/SidebarPrimaryNavigation";
import { APP_ROUTES } from "#product/config/app-routes";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useOpenSupportReportWindow } from "#product/hooks/support/workflows/use-open-support-report-window";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import { useShortcutRevealVisible } from "#product/providers/ShortcutRevealProvider";

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
    <SidebarScrollingNavigation
      workspacesActive={location.pathname === APP_ROUTES.workspaces}
      workflowsActive={location.pathname.startsWith(APP_ROUTES.workflows)}
      supportActive={false}
      onGoWorkspaces={onGoWorkspaces}
      onGoWorkflows={onGoWorkflows}
      onOpenSupport={handleOpenSupport}
      shortcutRevealVisible={shortcutRevealVisible}
      supportShortcutLabel={getShortcutDisplayLabel(SHORTCUTS.openSupport)}
    />
  );
}
