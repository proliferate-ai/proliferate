import {
  Archive,
  Blocks,
  CalendarClock,
  Grid,
  Home,
  LifeBuoy,
} from "@/components/ui/icons";
import {
  ProductSidebarPrimaryNavigation,
  type SidebarNavItemView,
} from "@proliferate/product-ui/sidebar/ProductSidebar";

interface SidebarPrimaryNavigationProps {
  homeActive: boolean;
  pluginsActive: boolean;
  automationsActive: boolean;
  workspacesActive: boolean;
  archivedActive: boolean;
  supportActive: boolean;
  shortcutRevealVisible: boolean;
  shortcutLabels: {
    home: string;
    plugins: string;
    automations: string;
    support: string;
  };
  onGoHome: () => void;
  onGoPlugins: () => void;
  onGoAutomations: () => void;
  onGoWorkspaces: () => void;
  onGoArchived: () => void;
  onOpenSupport: () => void;
}

export function SidebarPrimaryNavigation({
  homeActive,
  pluginsActive,
  automationsActive,
  workspacesActive,
  archivedActive,
  supportActive,
  shortcutRevealVisible,
  shortcutLabels,
  onGoHome,
  onGoPlugins,
  onGoAutomations,
  onGoWorkspaces,
  onGoArchived,
  onOpenSupport,
}: SidebarPrimaryNavigationProps) {
  const navItems: SidebarNavItemView[] = [
    {
      id: "home",
      active: homeActive,
      icon: <Home className="size-4" />,
      label: "Home",
      shortcutLabel: shortcutLabels.home,
    },
    {
      id: "plugins",
      active: pluginsActive,
      icon: <Blocks className="size-4" />,
      label: "Plugins",
      shortcutLabel: shortcutLabels.plugins,
    },
    {
      id: "workspaces",
      active: workspacesActive,
      icon: <Grid className="size-4" />,
      label: "Workspaces",
    },
    {
      id: "archived",
      active: archivedActive,
      icon: <Archive className="size-4" />,
      label: "Archived",
    },
    {
      id: "automations",
      active: automationsActive,
      icon: <CalendarClock className="size-4" />,
      label: "Automations",
      shortcutLabel: shortcutLabels.automations,
    },
    {
      id: "support",
      active: supportActive,
      icon: <LifeBuoy className="size-4" />,
      label: "Support",
      shortcutLabel: shortcutLabels.support,
    },
  ];

  const handleNavSelect = (id: string) => {
    switch (id) {
      case "home":
        onGoHome();
        break;
      case "plugins":
        onGoPlugins();
        break;
      case "workspaces":
        onGoWorkspaces();
        break;
      case "archived":
        onGoArchived();
        break;
      case "automations":
        onGoAutomations();
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
    />
  );
}
