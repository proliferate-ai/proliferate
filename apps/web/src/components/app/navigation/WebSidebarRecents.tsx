import {
  CalendarClock,
  CircleAlert,
  Cloud,
  Hash,
  Monitor,
  Smartphone,
  Terminal,
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  RecentWorkItemView,
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import type { SidebarWorkspaceGroupView } from "@proliferate/product-ui/sidebar/ProductSidebarModel";
import { RecentWorkStatusDot } from "@proliferate/product-ui/workspaces/RecentWorkStatusDot";

import type { CloudSidebarRouteState } from "../../../lib/domain/sidebar/cloud-sidebar-model";

export function buildRecentWorkspaceGroups(input: {
  items: readonly RecentWorkItemView[];
  routeState: CloudSidebarRouteState;
}): SidebarWorkspaceGroupView[] {
  return [{
    id: "recents",
    label: "Recents",
    count: input.items.length,
    collapsed: false,
    headerHidden: true,
    rows: input.items.map((item) => ({
      id: item.id,
      label: recentRowTitle(item),
      subtitle: null,
      active: recentRowIsActive(item, input.routeState),
      archived: item.state === "done",
      status: <RecentSourceIndicator item={item} />,
      attentionStatus: (
        <RecentWorkStatusDot
          indicator={item.statusIndicator}
          surface="sidebar"
        />
      ),
      detail: null,
      trailingLabel: item.lastActivityLabel,
      actions: [],
    })),
    actions: [],
  }];
}

function recentRowTitle(item: RecentWorkItemView): string {
  if (item.rowKind !== "session") {
    return item.title;
  }
  return cleanRecentSessionTitle(item.title) ?? "Chat session";
}

function cleanRecentSessionTitle(title: string | null | undefined): string | null {
  const value = title?.trim();
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "invalid input"
    || normalized === "unclear input"
    || normalized === "stray keystroke"
    || normalized === "single character input"
  ) {
    return null;
  }
  return value;
}

function recentRowIsActive(
  item: RecentWorkItemView,
  route: CloudSidebarRouteState,
): boolean {
  if (item.rowKind === "session") {
    return route.workspaceId === item.workspaceId && route.sessionId === item.sessionId;
  }
  return route.workspaceId === item.workspaceId && !route.sessionId;
}

function RecentSourceIndicator({ item }: { item: RecentWorkItemView }) {
  const icon = runtimeIcon(item.runtimeLocation, item.sourceKind);
  return (
    <span
      className="flex size-4 items-center justify-center text-sidebar-muted-foreground"
      title={runtimeIndicatorLabel(item)}
      aria-label={runtimeIndicatorLabel(item)}
    >
      {icon}
    </span>
  );
}

function runtimeIcon(
  runtimeLocation: RecentWorkRuntimeLocation,
  sourceKind: RecentWorkSourceKind,
): ReactNode {
  switch (runtimeLocation) {
    case "local_desktop":
      return <Monitor className="size-3.5" />;
    case "ssh_remote":
      return <Terminal className="size-3.5" />;
    case "offline":
      return <CircleAlert className="size-3.5" />;
    case "cloud_sandbox":
      return <Cloud className="size-3.5" />;
    case "unknown":
      break;
  }

  switch (sourceKind) {
    case "mobile":
      return <Smartphone className="size-3.5" />;
    case "slack":
      return <Hash className="size-3.5" />;
    case "personal_automation":
    case "team_automation":
      return <CalendarClock className="size-3.5" />;
    case "desktop_exposed":
    case "cloud_sandbox":
    case "web":
    case "api":
    case "unknown":
      return <Cloud className="size-3.5" />;
  }
}

function runtimeIndicatorLabel(item: RecentWorkItemView): string {
  const ownership = item.ownership === "unclaimed" ? " Unclaimed." : "";
  return `Runtime: ${item.runtimeLabel}. Source: ${item.sourceLabel}.${ownership}`;
}
