import {
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
  workflowsActive: boolean;
  supportActive: boolean;
  shortcutRevealVisible: boolean;
  shortcutLabels: {
    newChat: string;
    support: string;
  };
  onGoHome: () => void;
  onGoWorkspaces: () => void;
  onGoWorkflows: () => void;
  onOpenSupport: () => void;
}

export function SidebarPrimaryNavigation({
  homeActive,
  workspacesActive,
  workflowsActive,
  supportActive,
  shortcutRevealVisible,
  shortcutLabels,
  onGoHome,
  onGoWorkspaces,
  onGoWorkflows,
  onOpenSupport,
}: SidebarPrimaryNavigationProps) {
  const navItems: SidebarNavItemView[] = [
    {
      id: "new-chat",
      active: homeActive,
      icon: <SquarePen className="size-[var(--sidebar-primary-icon-size)]" />,
      label: "New chat",
      shortcutLabel: shortcutLabels.newChat,
    },
    {
      id: "workspaces",
      active: workspacesActive,
      icon: <LayoutGrid className="size-[var(--sidebar-primary-icon-size)]" />,
      label: "Workspaces",
    },
    {
      id: "workflows",
      active: workflowsActive,
      icon: <Zap className="size-[var(--sidebar-primary-icon-size)]" />,
      label: "Workflows",
      status: (
        <span className="font-mono text-ui-sm uppercase tracking-[0.06em] text-sidebar-muted-foreground">
          beta
        </span>
      ),
    },
    {
      id: "support",
      active: supportActive,
      icon: <LifeBuoy className="size-[var(--sidebar-primary-icon-size)]" />,
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
