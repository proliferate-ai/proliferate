import {
  Calendar,
  CircleHelp,
  Grid2X2,
  Home,
  Settings,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type {
  SidebarActionEvent,
  SidebarNavItemView,
} from "@proliferate/product-ui/sidebar/ProductSidebar";
import { ProductSidebar } from "@proliferate/product-ui/sidebar/ProductSidebar";

import { routes } from "../../../config/routes";

export function WebSidebarController() {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = useMemo(
    () => buildNavItems(location.pathname),
    [location.pathname],
  );
  const workspaceGroups = useMemo(() => [], []);
  const chatRows = useMemo(() => [], []);

  function navigateByNavId(id: string) {
    switch (id) {
      case "home":
        navigate(routes.home);
        return;
      case "automations":
        navigate(routes.automations);
        return;
      case "plugins":
        navigate(routes.plugins);
        return;
      case "support":
        navigate(routes.support);
        return;
      default:
        return;
    }
  }

  function handleAction(event: SidebarActionEvent) {
    if (event.scope === "footer" && event.actionId === "settings") {
      navigate(routes.settings);
    }
  }

  return (
    <div className="contents" data-telemetry-block>
      <ProductSidebar
        navItems={navItems}
        workspaceGroups={workspaceGroups}
        chatRows={chatRows}
        footerActions={[
          {
            id: "settings",
            label: "Settings",
            icon: <Settings className="size-3.5" />,
          },
        ]}
        onNavSelect={navigateByNavId}
        onWorkspaceSelect={() => undefined}
        onChatSelect={() => undefined}
        onGroupToggle={() => undefined}
        onAction={handleAction}
      />
    </div>
  );
}

function buildNavItems(pathname: string): SidebarNavItemView[] {
  return [
    {
      id: "home",
      label: "Home",
      icon: <Home className="size-4" />,
      active: pathname === routes.home,
    },
    {
      id: "plugins",
      label: "Plugins",
      icon: <Grid2X2 className="size-4" />,
      active: pathname.startsWith(routes.plugins),
    },
    {
      id: "automations",
      label: "Automations",
      icon: <Calendar className="size-4" />,
      active: pathname.startsWith(routes.automations),
    },
    {
      id: "support",
      label: "Support",
      icon: <CircleHelp className="size-4" />,
      active: pathname.startsWith(routes.support),
    },
  ];
}
