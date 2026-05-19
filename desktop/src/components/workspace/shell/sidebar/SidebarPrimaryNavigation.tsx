import {
  Calendar,
  CircleQuestion,
  Grid,
  Home,
} from "@/components/ui/icons";
import {
  ProductSidebarPrimaryNavigation,
  type SidebarNavItemView,
} from "@proliferate/product-ui/sidebar/ProductSidebar";
import { SHORTCUTS } from "@/config/shortcuts";

interface SidebarPrimaryNavigationProps {
  homeActive: boolean;
  pluginsActive: boolean;
  automationsActive: boolean;
  supportActive: boolean;
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
      shortcutLabel: SHORTCUTS.goHome.label,
    },
    {
      id: "plugins",
      active: pluginsActive,
      icon: <Grid className="size-4" />,
      label: "Plugins",
      shortcutLabel: SHORTCUTS.goPlugins.label,
    },
    {
      id: "automations",
      active: automationsActive,
      icon: <Calendar className="size-4" />,
      label: "Automations",
      shortcutLabel: SHORTCUTS.goAutomations.label,
    },
    {
      id: "support",
      active: supportActive,
      icon: <CircleQuestion className="size-4" />,
      label: "Support",
      shortcutLabel: SHORTCUTS.openSupport.label,
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
    />
  );
}
