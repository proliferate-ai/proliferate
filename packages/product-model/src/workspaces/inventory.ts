import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import type {
  RecentWorkCloudAccessState,
  RecentWorkCommandability,
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
} from "./cloud-work-inventory";
import {
  cloudWorkspaceInventoryItem,
  sortedCloudWorkspaces,
} from "./inventory-cloud";

export type WorkspaceInventorySourceKind = RecentWorkSourceKind;

export type WorkspaceInventoryLocationKind =
  | "worktree"
  | "local"
  | "managed_personal"
  | "managed_shared"
  | "ssh"
  | "self_hosted"
  | "cloud"
  | "session"
  | "other";

export type WorkspaceInventoryStatusKind =
  | "waiting"
  | "working"
  | "review"
  | "blocked"
  | "done";

export type WorkspaceInventoryOwnershipKind =
  | "mine"
  | "unclaimed"
  | "claimed"
  | "team"
  | "archived";

export type WorkspaceInventoryFilterId =
  | "all"
  | "mine"
  | "unclaimed"
  | "attention"
  | `source:${WorkspaceInventorySourceKind}`
  | `runtime:${RecentWorkRuntimeLocation}`;

export type WorkspaceInventoryGroupBy =
  | "ownership"
  | "source"
  | "status"
  | "runtime";

export interface WorkspaceInventoryItemView {
  id: string;
  title: string;
  description?: string | null;
  repoLabel?: string | null;
  branchLabel?: string | null;
  sourceKind: WorkspaceInventorySourceKind;
  sourceLabel: string;
  locationKind: WorkspaceInventoryLocationKind;
  locationLabel: string;
  runtimeLocation: RecentWorkRuntimeLocation;
  runtimeLocationLabel: string;
  cloudAccessState: RecentWorkCloudAccessState;
  cloudAccessLabel: string;
  commandability: RecentWorkCommandability;
  commandabilityLabel: string;
  scopeLabel?: string | null;
  statusKind: WorkspaceInventoryStatusKind;
  statusLabel: string;
  ownershipKind?: WorkspaceInventoryOwnershipKind;
  ownerLabel?: string | null;
  exposureLabel?: string | null;
  sessionLabel?: string | null;
  updatedLabel?: string | null;
  active?: boolean;
}

export interface WorkspaceInventoryGroupView {
  id: string;
  label: string;
  count: number;
  statusKind?: WorkspaceInventoryStatusKind;
  suppressOwnerLabel?: boolean;
  collapsed?: boolean;
  attention?: boolean;
  items: WorkspaceInventoryItemView[];
}

export interface WorkspaceInventoryFilterOption {
  id: WorkspaceInventoryFilterId;
  label: string;
  count: number;
}

export interface WorkspaceInventoryGroupOption {
  id: WorkspaceInventoryGroupBy;
  label: string;
}

export interface BuildCloudWorkspaceInventoryOptions {
  now?: number;
}

const SOURCE_ORDER: Record<WorkspaceInventorySourceKind, number> = {
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

const RUNTIME_ORDER: Record<RecentWorkRuntimeLocation, number> = {
  local_desktop: 0,
  cloud_sandbox: 1,
  ssh_remote: 2,
  offline: 3,
  unknown: 4,
};

const STATUS_ORDER: WorkspaceInventoryStatusKind[] = [
  "blocked",
  "review",
  "working",
  "waiting",
  "done",
];

const STATUS_GROUP_LABELS: Record<WorkspaceInventoryStatusKind, string> = {
  blocked: "Blocked",
  review: "Ready for review",
  working: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const WORKSPACE_INVENTORY_GROUP_OPTIONS: readonly WorkspaceInventoryGroupOption[] = [
  { id: "ownership", label: "Ownership" },
  { id: "source", label: "Source" },
  { id: "runtime", label: "Runtime" },
  { id: "status", label: "Status" },
];

export function buildCloudWorkspaceInventoryItems(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildCloudWorkspaceInventoryOptions = {},
): WorkspaceInventoryItemView[] {
  const now = options.now ?? Date.now();
  return sortedCloudWorkspaces(workspaces).map((workspace) =>
    cloudWorkspaceInventoryItem(workspace, now),
  );
}

export function buildWorkspaceInventoryFilterOptions(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryFilterOption[] {
  const base: WorkspaceInventoryFilterOption[] = [
    { id: "all", label: "All", count: items.length },
    {
      id: "mine",
      label: "Mine",
      count: items.filter((item) => itemOwnershipKind(item) === "mine").length,
    },
    {
      id: "unclaimed",
      label: "Unclaimed",
      count: items.filter((item) => itemOwnershipKind(item) === "unclaimed").length,
    },
    {
      id: "attention",
      label: "Needs attention",
      count: items.filter(workspaceNeedsAttention).length,
    },
  ];
  const sourceOptions = sourceFilterOptions(items);
  const runtimeOptions = runtimeFilterOptions(items);
  return [...base, ...sourceOptions, ...runtimeOptions];
}

export function filterWorkspaceInventoryItems(
  items: readonly WorkspaceInventoryItemView[],
  filterId: WorkspaceInventoryFilterId,
): WorkspaceInventoryItemView[] {
  switch (filterId) {
    case "mine":
      return items.filter((item) => itemOwnershipKind(item) === "mine");
    case "unclaimed":
      return items.filter((item) => itemOwnershipKind(item) === "unclaimed");
    case "attention":
      return items.filter(workspaceNeedsAttention);
    case "all":
      return [...items];
    default:
      if (filterId.startsWith("source:")) {
        const sourceKind = filterId.slice("source:".length) as WorkspaceInventorySourceKind;
        return items.filter((item) => item.sourceKind === sourceKind);
      }
      if (filterId.startsWith("runtime:")) {
        const runtimeLocation = filterId.slice("runtime:".length) as RecentWorkRuntimeLocation;
        return items.filter((item) => item.runtimeLocation === runtimeLocation);
      }
      return [...items];
  }
}

export function groupWorkspaceInventoryItems(
  items: readonly WorkspaceInventoryItemView[],
  groupBy: WorkspaceInventoryGroupBy,
  collapsedGroupIds: ReadonlySet<string> = new Set(),
): WorkspaceInventoryGroupView[] {
  const groups =
    groupBy === "ownership"
      ? groupInventoryByOwnership(items)
      : groupBy === "status"
        ? groupInventoryByStatus(items)
        : groupBy === "runtime"
          ? groupInventoryByRuntime(items)
          : groupInventoryBySource(items);
  return groups.map((group) => ({
    ...group,
    collapsed: collapsedGroupIds.has(group.id),
  }));
}

export function groupInventoryByOwnership(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryGroupView[] {
  const unclaimed = items.filter((item) => itemOwnershipKind(item) === "unclaimed");
  const personal = items.filter((item) => itemOwnershipKind(item) === "mine");
  const claimed = items.filter((item) => itemOwnershipKind(item) === "claimed");
  const team = items.filter((item) => itemOwnershipKind(item) === "team");
  const archived = items.filter((item) => itemOwnershipKind(item) === "archived");
  const groups: WorkspaceInventoryGroupView[] = [];
  if (unclaimed.length > 0) {
    groups.push({
      id: "unclaimed",
      label: "Unclaimed",
      count: unclaimed.length,
      attention: true,
      suppressOwnerLabel: true,
      items: unclaimed,
    });
  }
  if (personal.length > 0) {
    groups.push({
      id: "mine",
      label: "Mine",
      count: personal.length,
      suppressOwnerLabel: true,
      items: personal,
    });
  }
  if (claimed.length > 0) {
    groups.push({
      id: "claimed",
      label: "Claimed",
      count: claimed.length,
      suppressOwnerLabel: true,
      items: claimed,
    });
  }
  if (team.length > 0) {
    groups.push({
      id: "team",
      label: "Team",
      count: team.length,
      suppressOwnerLabel: true,
      items: team,
    });
  }
  if (archived.length > 0) {
    groups.push({
      id: "archived",
      label: "Archived",
      count: archived.length,
      statusKind: "done",
      suppressOwnerLabel: true,
      items: archived,
    });
  }
  return groups;
}

export function groupInventoryByStatus(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryGroupView[] {
  return STATUS_ORDER.map((statusKind) => {
    const groupItems = items.filter((item) => item.statusKind === statusKind);
    return {
      id: statusKind,
      label: STATUS_GROUP_LABELS[statusKind],
      count: groupItems.length,
      statusKind,
      attention: statusKind === "blocked" || statusKind === "review",
      items: groupItems,
    };
  }).filter((group) => group.items.length > 0);
}

export function groupInventoryBySource(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryGroupView[] {
  const groups = new Map<
    WorkspaceInventorySourceKind,
    { label: string; order: number; items: WorkspaceInventoryItemView[] }
  >();
  for (const item of items) {
    const existing = groups.get(item.sourceKind);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.sourceKind, {
        label: groupLabelForSource(item.sourceKind),
        order: SOURCE_ORDER[item.sourceKind],
        items: [item],
      });
    }
  }
  return Array.from(groups.entries())
    .sort(([, left], [, right]) => left.order - right.order)
    .map(([kind, { label, items: groupItems }]) => ({
      id: kind,
      label,
      count: groupItems.length,
      items: groupItems,
    }));
}

export function groupInventoryByRuntime(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryGroupView[] {
  const groups = new Map<
    RecentWorkRuntimeLocation,
    { label: string; order: number; items: WorkspaceInventoryItemView[] }
  >();
  for (const item of items) {
    const existing = groups.get(item.runtimeLocation);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.runtimeLocation, {
        label: item.runtimeLocationLabel,
        order: RUNTIME_ORDER[item.runtimeLocation],
        items: [item],
      });
    }
  }
  return Array.from(groups.entries())
    .sort(([, left], [, right]) => left.order - right.order)
    .map(([kind, { label, items: groupItems }]) => ({
      id: kind,
      label,
      count: groupItems.length,
      statusKind: kind === "offline" ? "blocked" : undefined,
      attention: kind === "offline",
      items: groupItems,
    }));
}

export function buildCloudWorkspaceInventoryGroups(
  workspaces: readonly CloudWorkspaceSummary[],
  groupBy: WorkspaceInventoryGroupBy = "source",
  options: BuildCloudWorkspaceInventoryOptions = {},
): WorkspaceInventoryGroupView[] {
  return groupWorkspaceInventoryItems(
    buildCloudWorkspaceInventoryItems(workspaces, options),
    groupBy,
  );
}

export function workspaceInventorySummaryLabel(
  items: readonly WorkspaceInventoryItemView[],
): string {
  const unclaimedCount = items.filter(
    (item) => itemOwnershipKind(item) === "unclaimed",
  ).length;
  const reviewCount = items.filter((item) => item.statusKind === "review").length;
  return [
    formatWorkspaceCount(items.length),
    unclaimedCount > 0 ? `${unclaimedCount} unclaimed` : null,
    reviewCount > 0 ? `${reviewCount} ready for review` : null,
  ].filter(Boolean).join(" · ");
}

export function workspaceInventorySyncLabel(
  dataUpdatedAt: number,
  now: number = Date.now(),
): string {
  if (!dataUpdatedAt) {
    return "Not synced";
  }
  const elapsedMs = now - dataUpdatedAt;
  if (elapsedMs < 60_000) {
    return "Updated now";
  }
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) {
    return `Updated ${elapsedMinutes}m ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `Updated ${elapsedHours}h ago`;
  }
  return `Updated ${Math.floor(elapsedHours / 24)}d ago`;
}

function workspaceNeedsAttention(item: WorkspaceInventoryItemView): boolean {
  return (
    item.statusKind === "blocked" ||
    item.statusKind === "review" ||
    itemOwnershipKind(item) === "unclaimed"
  );
}

function groupLabelForSource(kind: WorkspaceInventorySourceKind): string {
  switch (kind) {
    case "desktop_exposed":
      return "Desktop";
    case "cloud_sandbox":
      return "Cloud sandbox";
    case "web":
      return "Web";
    case "mobile":
      return "Mobile";
    case "personal_automation":
      return "Personal automations";
    case "team_automation":
      return "Team automations";
    case "slack":
      return "Slack";
    case "api":
      return "API";
    case "unknown":
      return "Unknown source";
  }
}

function sourceFilterOptions(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryFilterOption[] {
  const counts = new Map<WorkspaceInventorySourceKind, { label: string; count: number }>();
  for (const item of items) {
    const current = counts.get(item.sourceKind);
    counts.set(item.sourceKind, {
      label: item.sourceLabel,
      count: (current?.count ?? 0) + 1,
    });
  }
  return Array.from(counts.entries())
    .sort(([leftKind], [rightKind]) => SOURCE_ORDER[leftKind] - SOURCE_ORDER[rightKind])
    .map(([kind, value]) => ({
      id: `source:${kind}` as const,
      label: value.label,
      count: value.count,
    }));
}

function runtimeFilterOptions(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryFilterOption[] {
  const counts = new Map<RecentWorkRuntimeLocation, { label: string; count: number }>();
  for (const item of items) {
    const current = counts.get(item.runtimeLocation);
    counts.set(item.runtimeLocation, {
      label: item.runtimeLocationLabel,
      count: (current?.count ?? 0) + 1,
    });
  }
  return Array.from(counts.entries())
    .sort(([leftKind], [rightKind]) => RUNTIME_ORDER[leftKind] - RUNTIME_ORDER[rightKind])
    .map(([kind, value]) => ({
      id: `runtime:${kind}` as const,
      label: value.label,
      count: value.count,
    }));
}

function itemOwnershipKind(
  item: WorkspaceInventoryItemView,
): WorkspaceInventoryOwnershipKind {
  if (item.ownershipKind) {
    return item.ownershipKind;
  }
  switch (item.ownerLabel) {
    case "Unclaimed":
      return "unclaimed";
    case "Claimed":
      return "claimed";
    case "Archived":
      return "archived";
    case "Team":
      return "team";
    case "Mine":
    case null:
    case undefined:
      return "mine";
    default:
      return "team";
  }
}

function formatWorkspaceCount(count: number): string {
  return `${count} ${count === 1 ? "workspace" : "workspaces"}`;
}
