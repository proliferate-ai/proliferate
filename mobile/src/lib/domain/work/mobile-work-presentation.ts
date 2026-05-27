import type {
  CloudWorkStatusFilter,
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
} from "@proliferate/product-model/workspaces/cloud-work-inventory";

import type { MobileIconName } from "../../../components/primitives/MobileIcon";

export function mobileIconForWorkSourceKind(sourceKind: RecentWorkSourceKind): MobileIconName {
  switch (sourceKind) {
    case "mobile":
      return "smartphone";
    case "cloud_sandbox":
      return "cloud";
    case "desktop_exposed":
      return "monitor";
    case "slack":
      return "slack";
    case "personal_automation":
    case "team_automation":
      return "calendar-clock";
    case "api":
      return "cloud";
    case "web":
      return "cloud";
    case "unknown":
    default:
      return "workspaces";
  }
}

export function mobileIconForRuntimeLocation(runtimeLocation: RecentWorkRuntimeLocation): MobileIconName {
  switch (runtimeLocation) {
    case "local_desktop":
      return "monitor";
    case "cloud_sandbox":
      return "cloud";
    case "ssh_remote":
      return "external";
    case "offline":
      return "lock";
    case "unknown":
    default:
      return "workspaces";
  }
}

export function mobileIconForWorkStatus(status: CloudWorkStatusFilter): MobileIconName {
  switch (status) {
    case "active":
    case "running":
      return "sessions";
    case "blocked":
    case "error":
      return "lock";
    case "archived":
      return "folder";
    case "ready":
    default:
      return "check";
  }
}
