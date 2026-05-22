import {
  Blocks,
  CalendarClock,
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
  onOpenSupport: () => void;
}

export function SidebarPrimaryNavigation({
  homeActive,
  pluginsActive,
  automationsActive,
  supportActive,
  shortcutRevealVisible,
  shortcutLabels,
  onGoHome,
  onGoPlugins,
  onGoAutomations,
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
