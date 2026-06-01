import {
  Blocks,
  CalendarClock,
  Cloud,
  House,
  LifeBuoy,
} from "lucide-react";

import type { SidebarNavItemView } from "@proliferate/product-ui/sidebar/ProductSidebarModel";

import { routes } from "../../../config/routes";
import type { CloudSidebarRouteState } from "../../../lib/domain/sidebar/cloud-sidebar-model";

export function buildNavItems(
  pathname: string,
  routeState: CloudSidebarRouteState,
): SidebarNavItemView[] {
  return [
    {
      id: "home",
      label: "Home",
      icon: <House className="size-4" />,
      active: pathname === routes.home,
    },
    {
      id: "workspaces",
      label: "Workspaces",
      icon: <Cloud className="size-4" />,
      active: routeState.workspacesActive,
    },
    {
      id: "plugins",
      label: "Plugins",
      icon: <Blocks className="size-4" />,
      active: pathname.startsWith(routes.plugins),
    },
    {
      id: "automations",
      label: "Automations",
      icon: <CalendarClock className="size-4" />,
      active: pathname.startsWith(routes.automations),
    },
    {
      id: "support",
      label: "Support",
      icon: <LifeBuoy className="size-4" />,
      active: pathname.startsWith(routes.support),
    },
  ];
}
