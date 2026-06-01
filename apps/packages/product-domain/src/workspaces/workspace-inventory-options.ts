import type {
  WorkspaceInventoryGroupOption,
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusFilterKind,
  WorkspaceInventoryStatusKind,
} from "./workspace-inventory-types";
import type { RecentWorkRuntimeLocation } from "./cloud-work-inventory";

export const SOURCE_ORDER: Record<WorkspaceInventorySourceKind, number> = {
  desktop_exposed: 0,
  cloud_sandbox: 1,
  web: 2,
  mobile: 3,
  personal_automation: 4,
  team_automation: 5,
  slack: 6,
  api: 7,
  unknown: 8,
};

export const RUNTIME_ORDER: Record<RecentWorkRuntimeLocation, number> = {
  local_desktop: 0,
  cloud_sandbox: 1,
  ssh_remote: 2,
  offline: 3,
  unknown: 4,
};

export const STATUS_ORDER: WorkspaceInventoryStatusKind[] = [
  "blocked",
  "review",
  "working",
  "waiting",
  "done",
];

export const STATUS_GROUP_LABELS: Record<WorkspaceInventoryStatusKind, string> = {
  blocked: "Blocked",
  review: "Ready for review",
  working: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const STATUS_FILTER_OPTIONS: readonly {
  id: WorkspaceInventoryStatusFilterKind;
  label: string;
}[] = [
  { id: "active", label: "Live" },
  { id: "running", label: "Running" },
  { id: "blocked", label: "Needs input" },
  { id: "ready", label: "Ready" },
  { id: "error", label: "Error" },
  { id: "archived", label: "Archived" },
];

export const WORKSPACE_INVENTORY_GROUP_OPTIONS: readonly WorkspaceInventoryGroupOption[] = [
  { id: "ownership", label: "Ownership" },
  { id: "source", label: "Source" },
  { id: "runtime", label: "Runtime" },
  { id: "status", label: "Status" },
];
