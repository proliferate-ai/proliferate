import { AppShellNewChatIcon } from "#product/primitives/icons/app-shell";
import { Fork, LifeBuoy } from "#product/primitives/icons/core";
import { Grid } from "#product/primitives/icons/platform";
import type { SidebarNavItemView } from "#product/components/workspace/shell/sidebar/ProductSidebarNavigation";
import { ProductSidebarPrimaryNavigation } from "#product/components/workspace/shell/sidebar/ProductSidebarNavigation";

/**
 * The sidebar's primary navigation, split across the scroll boundary.
 *
 * New chat is the one row that must always be reachable, so it stays pinned
 * with the brand row above the scroll region. Workspaces, Workflows and
 * Support are destinations rather than the primary action; they scroll away
 * with the repository list, which is what buys that list its vertical room
 * back on short windows.
 *
 * The glyphs carry no size class: `SidebarNavRow`'s icon well sizes them with
 * a `[&>svg]` compound selector that beats anything passed here, so a class
 * on the glyph would describe a size it does not get.
 */

interface SidebarPinnedNavigationProps {
  homeActive: boolean;
  shortcutRevealVisible: boolean;
  newChatShortcutLabel: string;
  onGoHome: () => void;
}

export function SidebarPinnedNavigation({
  homeActive,
  shortcutRevealVisible,
  newChatShortcutLabel,
  onGoHome,
}: SidebarPinnedNavigationProps) {
  const navItems: SidebarNavItemView[] = [
    {
      id: "new-chat",
      active: homeActive,
      icon: <AppShellNewChatIcon />,
      label: "New chat",
      shortcutLabel: newChatShortcutLabel,
    },
  ];

  return (
    <ProductSidebarPrimaryNavigation
      navItems={navItems}
      onNavSelect={onGoHome}
      shortcutRevealVisible={shortcutRevealVisible}
    />
  );
}

interface SidebarScrollingNavigationProps {
  workspacesActive: boolean;
  /** False while the workflows_v2 gate is off: the row is omitted entirely,
   * not rendered disabled. */
  showWorkflows: boolean;
  workflowsActive: boolean;
  supportActive: boolean;
  shortcutRevealVisible: boolean;
  supportShortcutLabel: string;
  onGoWorkspaces: () => void;
  onGoWorkflows: () => void;
  onOpenSupport: () => void;
}

export function SidebarScrollingNavigation({
  workspacesActive,
  showWorkflows,
  workflowsActive,
  supportActive,
  shortcutRevealVisible,
  supportShortcutLabel,
  onGoWorkspaces,
  onGoWorkflows,
  onOpenSupport,
}: SidebarScrollingNavigationProps) {
  const navItems: SidebarNavItemView[] = [
    {
      id: "workspaces",
      active: workspacesActive,
      icon: <Grid />,
      label: "Workspaces",
    },
    ...(showWorkflows
      ? [{
        id: "workflows",
        active: workflowsActive,
        icon: <Fork />,
        label: "Workflows",
        status: (
          <span className="font-mono text-ui-sm uppercase tracking-[0.06em] text-sidebar-muted-foreground">
            beta
          </span>
        ),
      }]
      : []),
    {
      id: "support",
      active: supportActive,
      icon: <LifeBuoy strokeWidth={1.75} />,
      label: "Support",
      shortcutLabel: supportShortcutLabel,
    },
  ];

  const handleNavSelect = (id: string) => {
    switch (id) {
      case "workspaces":
        onGoWorkspaces();
        break;
      case "workflows":
        onGoWorkflows();
        break;
      case "support":
        onOpenSupport();
        break;
      default:
        break;
    }
  };

  return (
    <ProductSidebarPrimaryNavigation
      navItems={navItems}
      onNavSelect={handleNavSelect}
      shortcutRevealVisible={shortcutRevealVisible}
      // The scroll viewport already carries the sidebar gutter; a second one
      // would step these rows in from the repository rows beneath them.
      gutter={false}
    />
  );
}
