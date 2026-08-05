import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import type {
  BuildCloudWorkInventoryOptions,
  CloudWorkFilters,
  CloudWorkGroupView,
  CloudWorkItemView,
  CloudWorkOwnerFilter,
  CloudWorkRecencyGroupId,
  CloudWorkRecencyGroupView,
  CloudWorkSort,
} from "./cloud-work-inventory-types";
import { CLOUD_WORK_SOURCE_ORDER, SOURCE_LABELS } from "./cloud-work-inventory-types";
import { cloudWorkItemForWorkspace } from "./cloud-work-items";
import { statusRank } from "./cloud-work-labels";
import { dedupeCloudWorkspaces } from "./cloud-work-time";

export function buildCloudWorkInventory(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildCloudWorkInventoryOptions = {},
): CloudWorkGroupView[] {
  const nowMs = options.nowMs ?? Date.now();
  const items = filterCloudWorkItems(
    dedupeCloudWorkspaces(workspaces).map((workspace) => cloudWorkItemForWorkspace(workspace, { nowMs })),
    options.filters,
  ).sort(compareCloudWorkItemsForSort(options.filters?.sort));
  return CLOUD_WORK_SOURCE_ORDER.flatMap((source) => {
    const sourceItems = items.filter((item) => item.source === source);
    if (sourceItems.length === 0) {
      return [];
    }
    return [{
      id: source,
      label: SOURCE_LABELS[source],
      items: sourceItems,
    }];
  });
}

export function buildCloudWorkRecencyInventory(
  workspaces: readonly CloudWorkspaceSummary[],
  options: BuildCloudWorkInventoryOptions = {},
): CloudWorkRecencyGroupView[] {
  const nowMs = options.nowMs ?? Date.now();
  const items = filterCloudWorkItems(
    dedupeCloudWorkspaces(workspaces).map((workspace) => cloudWorkItemForWorkspace(workspace, { nowMs })),
    options.filters,
  ).sort(compareCloudWorkItemsForSort(options.filters?.sort));
  return groupCloudWorkItemsByRecency(items, { nowMs });
}

export function groupCloudWorkItemsByRecency(
  items: readonly CloudWorkItemView[],
  options: { nowMs?: number } = {},
): CloudWorkRecencyGroupView[] {
  const nowMs = options.nowMs ?? Date.now();
  const buckets: Record<CloudWorkRecencyGroupId, CloudWorkItemView[]> = {
    today: [],
    this_week: [],
    last_week: [],
    earlier: [],
  };
  for (const item of items) {
    buckets[recencyGroupForTime(item.lastActivityMs, nowMs)].push(item);
  }
  return RECENCY_GROUPS.flatMap((group) => {
    const groupItems = buckets[group.id];
    return groupItems.length > 0
      ? [{ id: group.id, label: group.label, items: groupItems }]
      : [];
  });
}

export function compareCloudWorkItems(left: CloudWorkItemView, right: CloudWorkItemView): number {
  const recencyDelta = right.lastActivityMs - left.lastActivityMs;
  if (recencyDelta !== 0) {
    return recencyDelta;
  }
  const statusDelta = statusRank(left.status) - statusRank(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return left.title.localeCompare(right.title);
}

export function compareCloudWorkItemsForSort(sort: CloudWorkSort = "recent") {
  return (left: CloudWorkItemView, right: CloudWorkItemView): number => {
    switch (sort) {
      case "created":
        return right.createdAtMs - left.createdAtMs
          || compareCloudWorkItems(left, right);
      case "name":
        return left.title.localeCompare(right.title)
          || compareCloudWorkItems(left, right);
      case "repo":
        return left.repoLabel.localeCompare(right.repoLabel)
          || left.title.localeCompare(right.title)
          || compareCloudWorkItems(left, right);
      case "status":
        return statusRank(left.status) - statusRank(right.status)
          || compareCloudWorkItems(left, right);
      case "recent":
      default:
        return compareCloudWorkItems(left, right);
    }
  };
}

export function filterCloudWorkItems(
  items: readonly CloudWorkItemView[],
  filters?: CloudWorkFilters,
): CloudWorkItemView[] {
  if (!filters) {
    return [...items];
  }
  const query = filters.search?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (filters.ownership && filters.ownership !== "all" && !matchesOwnerFilter(item, filters.ownership)) {
      return false;
    }
    if (filters.sources?.size && !filters.sources.has(item.source)) {
      return false;
    }
    if (filters.semanticSources?.size && !filters.semanticSources.has(item.sourceKind)) {
      return false;
    }
    if (filters.runtimeLocations?.size && !filters.runtimeLocations.has(item.runtimeLocation)) {
      return false;
    }
    if (filters.statuses?.size && !filters.statuses.has(item.status)) {
      return false;
    }
    if (filters.repoLabels?.size && !filters.repoLabels.has(item.repoLabel)) {
      return false;
    }
    if (filters.needsAttention && !cloudWorkItemNeedsAttention(item)) {
      return false;
    }
    if (query && !matchesSearch(item, query)) {
      return false;
    }
    return true;
  });
}

function cloudWorkItemNeedsAttention(item: CloudWorkItemView): boolean {
  return item.status === "blocked"
    || item.unclaimed
    || item.statusIndicator.kind === "needs_input";
}

const RECENCY_GROUPS = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "earlier", label: "Earlier" },
] as const satisfies readonly { id: CloudWorkRecencyGroupId; label: string }[];

function recencyGroupForTime(timeMs: number, nowMs: number): CloudWorkRecencyGroupId {
  const dayMs = 24 * 60 * 60 * 1000;
  const ageMs = Math.max(0, nowMs - timeMs);
  if (ageMs < dayMs) {
    return "today";
  }
  if (ageMs < 7 * dayMs) {
    return "this_week";
  }
  if (ageMs < 14 * dayMs) {
    return "last_week";
  }
  return "earlier";
}

function matchesOwnerFilter(item: CloudWorkItemView, filter: CloudWorkOwnerFilter): boolean {
  switch (filter) {
    case "private":
      return item.ownerKind === "private";
    case "shared":
      return item.ownerKind === "claimed" || item.ownerKind === "unclaimed";
    case "claimed":
      return item.ownerKind === "claimed";
    case "unclaimed":
      return item.ownerKind === "unclaimed";
    case "all":
      return true;
  }
}

function matchesSearch(item: CloudWorkItemView, query: string): boolean {
  return item.searchText.toLowerCase().includes(query)
    || item.subtitle.toLowerCase().includes(query);
}
