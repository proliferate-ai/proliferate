import { AppShellNewChatIcon, LayoutGrid, LifeBuoy, Workflow } from "@proliferate/ui/icons";
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
  // Round-3: the boxy framed glyphs (a pencil boxed in a square, a single
  // gridded square, an angular bolt) read heavier and squarer than the
  // reference nav column, whose glyphs are all open, rounded strokes with no
  // enclosing frame. Swapped for unframed equivalents at the same shared
  // 1.75 stroke weight — four independently rounded tiles for Workspaces, and
  // two rounded connected nodes for Workflows instead of a hard-angled bolt.
  //
  // Round-4 fix: New chat uses the owner-supplied compose glyph — a rounded
  // square whose top-right corner stays OPEN with an outlined pencil
  // overlapping it from outside the frame. lucide's SquarePen (a pencil boxed
  // inside a CLOSED square) is the original icon this run was asked to
  // replace; do not reintroduce it.
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
      icon: <LayoutGrid className="icon-paired" strokeWidth={1.75} />,
      label: "Workspaces",
    },
    {
      id: "workflows",
      active: workflowsActive,
      icon: <Workflow className="icon-paired" strokeWidth={1.75} />,
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
