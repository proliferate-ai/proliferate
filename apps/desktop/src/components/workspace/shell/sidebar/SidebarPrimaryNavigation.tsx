import {
  Blocks,
  LayoutGrid,
  LifeBuoy,
  SquarePen,
  Zap,
} from "lucide-react";
import type { SidebarNavItemView } from "@proliferate/product-ui/sidebar/ProductSidebarModel";
import { ProductSidebarPrimaryNavigation } from "@proliferate/product-ui/sidebar/ProductSidebarNavigation";

interface SidebarPrimaryNavigationProps {
  homeActive: boolean;
  workspacesActive: boolean;
  integrationsActive: boolean;
  workflowsActive: boolean;
  supportActive: boolean;
  shortcutRevealVisible: boolean;
  shortcutLabels: {
    newChat: string;
    support: string;
  };
  onGoHome: () => void;
  onGoWorkspaces: () => void;
  onGoIntegrations: () => void;
  onGoWorkflows: () => void;
  onOpenSupport: () => void;
}

export function SidebarPrimaryNavigation({
  homeActive,
  workspacesActive,
  integrationsActive,
  workflowsActive,
  supportActive,
  shortcutRevealVisible,
  shortcutLabels,
  onGoHome,
  onGoWorkspaces,
  onGoIntegrations,
  onGoWorkflows,
  onOpenSupport,
}: SidebarPrimaryNavigationProps) {
  const navItems: SidebarNavItemView[] = [
    {
      id: "new-chat",
      active: homeActive,
      icon: <SquarePen className="size-4" />,
      label: "New chat",
      shortcutLabel: shortcutLabels.newChat,
    },
    {
      id: "workspaces",
      active: workspacesActive,
      icon: <LayoutGrid className="size-4" />,
      label: "Workspaces",
    },
    {
      id: "workflows",
      active: workflowsActive,
      icon: <Zap className="size-4" />,
      label: "Workflows",
      status: (
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-sidebar-muted-foreground">
          beta
        </span>
      ),
    },
    {
      id: "integrations",
      active: integrationsActive,
      icon: <Blocks className="size-4" />,
      label: "Integrations",
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
      case "new-chat":
        onGoHome();
        break;
      case "workspaces":
        onGoWorkspaces();
        break;
      case "integrations":
        onGoIntegrations();
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
