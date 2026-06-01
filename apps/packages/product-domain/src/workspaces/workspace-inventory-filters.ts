import type {
  WorkspaceInventoryFilterOption,
  WorkspaceInventoryItemView,
  WorkspaceInventoryStatusFilterKind,
  WorkspaceInventoryFilterId,
} from "./workspace-inventory-types";
import { STATUS_FILTER_OPTIONS } from "./workspace-inventory-options";
import { itemOwnershipKind } from "./workspace-inventory-groups";

export function buildWorkspaceInventoryFilterOptions(
  items: readonly WorkspaceInventoryItemView[],
): WorkspaceInventoryFilterOption[] {
  return [
    { id: "all", label: "All", count: items.length },
    ...STATUS_FILTER_OPTIONS.map((option) => ({
      id: `status:${option.id}` as const,
      label: option.label,
      count: items.filter((item) => workspaceMatchesStatusFilter(item, option.id)).length,
    })),
  ];
}

export function filterWorkspaceInventoryItems(
  items: readonly WorkspaceInventoryItemView[],
  filterId: WorkspaceInventoryFilterId,
): WorkspaceInventoryItemView[] {
  if (filterId === "all") {
    return [...items];
  }
  const statusFilter = filterId.slice("status:".length) as WorkspaceInventoryStatusFilterKind;
  return items.filter((item) => workspaceMatchesStatusFilter(item, statusFilter));
}

export function workspaceMatchesStatusFilter(
  item: WorkspaceInventoryItemView,
  statusFilter: WorkspaceInventoryStatusFilterKind,
): boolean {
  return workspaceStatusFilterKind(item) === statusFilter;
}

export function workspaceStatusFilterKind(
  item: WorkspaceInventoryItemView,
): WorkspaceInventoryStatusFilterKind {
  if (item.statusFilterKind) {
    return item.statusFilterKind;
  }
  if (itemOwnershipKind(item) === "unclaimed") {
    return "blocked";
  }
  if (item.statusLabel.toLowerCase() === "error") {
    return "error";
  }
  if (item.statusKind === "blocked") {
    return "blocked";
  }
  if (item.statusKind === "working") {
    return "running";
  }
  if (item.statusKind === "done") {
    return "archived";
  }
  return "ready";
}
