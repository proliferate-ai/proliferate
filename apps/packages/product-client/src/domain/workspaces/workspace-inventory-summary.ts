import type { WorkspaceInventoryItemView } from "./workspace-inventory-types";
import { itemOwnershipKind } from "./workspace-inventory-groups";

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

export function formatWorkspaceCount(count: number): string {
  return `${count} ${count === 1 ? "workspace" : "workspaces"}`;
}
