import type { RecentWorkRuntimeLocation } from "./cloud-work-inventory";
import type {
  WorkspaceInventoryGroupBy,
  WorkspaceInventoryGroupView,
  WorkspaceInventoryItemView,
  WorkspaceInventoryOwnershipKind,
  WorkspaceInventorySourceKind,
} from "./workspace-inventory-types";
import {
  RUNTIME_ORDER,
  SOURCE_ORDER,
  STATUS_GROUP_LABELS,
  STATUS_ORDER,
} from "./workspace-inventory-options";

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

export function groupLabelForSource(kind: WorkspaceInventorySourceKind): string {
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

export function itemOwnershipKind(
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
