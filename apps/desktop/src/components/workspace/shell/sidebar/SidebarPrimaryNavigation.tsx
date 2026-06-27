import {
  Blocks,
  Home,
  LifeBuoy,
  Sparkles,
  Zap,
} from "@proliferate/ui/icons";
import type { SidebarNavItemView } from "@proliferate/product-ui/sidebar/ProductSidebarModel";
import { ProductSidebarPrimaryNavigation } from "@proliferate/product-ui/sidebar/ProductSidebarNavigation";

interface SidebarPrimaryNavigationProps {
  homeActive: boolean;
  integrationsActive: boolean;
  skillsActive: boolean;
  workflowsActive: boolean;
  supportActive: boolean;
  shortcutRevealVisible: boolean;
  shortcutLabels: {
    home: string;
    support: string;
  };
  onGoHome: () => void;
  onGoIntegrations: () => void;
  onGoSkills: () => void;
  onGoWorkflows: () => void;
  onOpenSupport: () => void;
}

export function SidebarPrimaryNavigation({
  homeActive,
  integrationsActive,
  skillsActive,
  workflowsActive,
  supportActive,
  shortcutRevealVisible,
  shortcutLabels,
  onGoHome,
  onGoIntegrations,
  onGoSkills,
  onGoWorkflows,
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
      id: "integrations",
      active: integrationsActive,
      icon: <Blocks className="size-4" />,
      label: "Integrations",
    },
    {
      id: "skills",
      active: skillsActive,
      icon: <Sparkles className="size-4" />,
      label: "Skills",
    },
    {
      id: "workflows",
      active: workflowsActive,
      icon: <Zap className="size-4" />,
      label: "Workflows",
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
      case "integrations":
        onGoIntegrations();
        break;
      case "skills":
        onGoSkills();
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
    />
  );
}
