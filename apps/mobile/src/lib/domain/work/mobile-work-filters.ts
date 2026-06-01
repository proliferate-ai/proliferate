import type {
  CloudWorkOwnerFilter,
  CloudWorkSort,
  CloudWorkStatusFilter,
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import type { MobileIconName } from "../../../components/primitives/MobileIcon";

export type MobileWorkTypeFilter =
  | "all"
  | "cloud"
  | "slack"
  | "personal_automation"
  | "team_automation"
  | "dispatch";
export type MobileWorkRuntimeFilter = RecentWorkRuntimeLocation | "all";
export type MobileWorkStatusFilter = CloudWorkStatusFilter | "all";
export type MobileWorkFilterPanel = "type" | "runtime" | "ownership" | "status" | "repo" | "sort";

export const MOBILE_WORK_TYPE_OPTIONS: readonly {
  id: MobileWorkTypeFilter;
  label: string;
  icon: MobileIconName;
}[] = [
  { id: "all", label: "All", icon: "workspaces" },
  { id: "cloud", label: "Cloud", icon: "cloud" },
  { id: "slack", label: "Slack", icon: "slack" },
  { id: "personal_automation", label: "Automation", icon: "calendar-clock" },
  { id: "team_automation", label: "Team automation", icon: "calendar-clock" },
  { id: "dispatch", label: "Dispatch", icon: "monitor" },
];

export const MOBILE_WORK_RUNTIME_OPTIONS: readonly {
  id: MobileWorkRuntimeFilter;
  label: string;
  icon: MobileIconName;
}[] = [
  { id: "all", label: "All runtimes", icon: "workspaces" },
  { id: "cloud_sandbox", label: "Cloud runtime", icon: "cloud" },
  { id: "local_desktop", label: "Desktop Mac", icon: "monitor" },
  { id: "ssh_remote", label: "SSH", icon: "external" },
  { id: "offline", label: "Offline", icon: "lock" },
];

export const MOBILE_WORK_OWNER_OPTIONS: readonly { id: CloudWorkOwnerFilter; label: string }[] = [
  { id: "all", label: "All ownership" },
  { id: "private", label: "Mine" },
  { id: "unclaimed", label: "Unclaimed" },
  { id: "claimed", label: "Claimed" },
  { id: "shared", label: "Shared" },
];

export const MOBILE_WORK_STATUS_OPTIONS: readonly { id: MobileWorkStatusFilter; label: string }[] = [
  { id: "all", label: "All status" },
  { id: "active", label: "Live" },
  { id: "running", label: "Running" },
  { id: "blocked", label: "Needs input" },
  { id: "ready", label: "Ready" },
  { id: "error", label: "Error" },
  { id: "archived", label: "Archived" },
];

export const MOBILE_WORK_SORT_OPTIONS: readonly { id: CloudWorkSort; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "created", label: "Created" },
  { id: "name", label: "Name" },
  { id: "repo", label: "Repo" },
  { id: "status", label: "Status" },
];

export function mobileWorkFilterPanelTitle(panel: MobileWorkFilterPanel): string {
  switch (panel) {
    case "type":
      return "Type";
    case "runtime":
      return "Runtime";
    case "ownership":
      return "Ownership";
    case "status":
      return "Status";
    case "repo":
      return "Repo";
    case "sort":
      return "Sort";
  }
}

export function semanticSourcesForMobileWorkType(
  type: MobileWorkTypeFilter,
): ReadonlySet<RecentWorkSourceKind> | undefined {
  switch (type) {
    case "cloud":
      return new Set<RecentWorkSourceKind>(["cloud_sandbox", "web", "mobile", "api"]);
    case "slack":
      return new Set<RecentWorkSourceKind>(["slack"]);
    case "personal_automation":
      return new Set<RecentWorkSourceKind>(["personal_automation"]);
    case "team_automation":
      return new Set<RecentWorkSourceKind>(["team_automation"]);
    case "dispatch":
      return new Set<RecentWorkSourceKind>(["desktop_exposed"]);
    case "all":
      return undefined;
  }
}

export function mobileWorkOptionLabel<T extends string>(
  options: readonly { id: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.id === value)?.label ?? value;
}
