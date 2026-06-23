import {
  Blocks,
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
      id: "integrations",
      label: "Integrations",
      icon: <Blocks className="size-4" />,
      active: pathname.startsWith(routes.integrations),
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
      status: <TbrPill />,
    },
  ];
}

function TbrPill() {
  return (
    <span
      aria-hidden="true"
      title="To be removed"
      className="rounded-sm border border-sidebar-border px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-normal text-sidebar-muted-foreground"
    >
      tbr
    </span>
  );
}
