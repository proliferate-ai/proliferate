import { AppShellNewChatIcon, Fork, Grid, LifeBuoy } from "@proliferate/ui/icons";
import type { SidebarNavItemView } from "#product/components/workspace/shell/sidebar/ProductSidebarNavigation";
import { ProductSidebarPrimaryNavigation } from "#product/components/workspace/shell/sidebar/ProductSidebarNavigation";

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
      icon: <AppShellNewChatIcon className="icon-paired" />,
      label: "New chat",
      shortcutLabel: shortcutLabels.newChat,
    },
    {
      id: "workspaces",
      active: workspacesActive,
      icon: <Grid className="icon-paired" />,
      label: "Workspaces",
    },
    {
      id: "workflows",
      active: workflowsActive,
      icon: <Fork className="icon-paired" />,
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
      icon: <LifeBuoy className="icon-paired" strokeWidth={1.75} />,
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
