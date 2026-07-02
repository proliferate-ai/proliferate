import {
  House,
  LifeBuoy,
  Zap,
} from "lucide-react";

import type { SidebarNavItemView } from "@proliferate/product-ui/sidebar/ProductSidebarModel";

import { routes } from "../../../config/routes";

export function buildNavItems(pathname: string): SidebarNavItemView[] {
  return [
    {
      id: "home",
      label: "Home",
      icon: <House className="size-4" />,
      active: pathname === routes.home,
    },
    {
      id: "workflows",
      label: "Workflows",
      icon: <Zap className="size-4" />,
      active: pathname.startsWith(routes.workflows),
    },
    {
      id: "support",
      label: "Support",
      icon: <LifeBuoy className="size-4" />,
      active: pathname.startsWith(routes.support),
    },
  ];
}
