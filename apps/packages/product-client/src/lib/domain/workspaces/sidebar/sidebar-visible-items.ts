import type { SidebarGroupState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";

type SidebarWorkspaceItem = SidebarGroupState["items"][number];

export function isSidebarWorkspaceOptimisticallyVisible(
  item: SidebarWorkspaceItem,
  optimisticallyArchivedIds: ReadonlySet<string>,
): boolean {
  return !optimisticallyArchivedIds.has(item.id)
    && !(item.localWorkspaceId !== null
      && optimisticallyArchivedIds.has(item.localWorkspaceId));
}

export function filterOptimisticallyArchivedSidebarGroups(
  groups: SidebarGroupState[],
  optimisticallyArchivedIds: ReadonlySet<string>,
): SidebarGroupState[] {
  if (optimisticallyArchivedIds.size === 0) {
    return groups;
  }

  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      isSidebarWorkspaceOptimisticallyVisible(item, optimisticallyArchivedIds)),
  }));
}

/**
 * Rows a repo group's body renders. Pinned rows are excluded — pinning MOVES
 * a workspace into the sidebar's Pinned section rather than duplicating it —
 * while `group.items` keeps the full visible inventory for lookups and the
 * pinned projection.
 */
export function sidebarGroupRowItems(group: SidebarGroupState): SidebarGroupState["items"] {
  return group.items.filter((item) => item.pinnedIds.length === 0);
}

export function visibleSidebarGroupItems(args: {
  group: SidebarGroupState;
  isShownMore: boolean;
  itemLimit: number;
}): SidebarGroupState["items"] {
  const { group, isShownMore, itemLimit } = args;
  const rowItems = sidebarGroupRowItems(group);
  if (isShownMore || rowItems.length <= itemLimit) {
    return rowItems;
  }

  const visibleItems = rowItems.slice(0, itemLimit);
  const activeItem = rowItems.find((item) => item.active);
  if (!activeItem || visibleItems.some((item) => item.id === activeItem.id)) {
    return visibleItems;
  }

  return [...visibleItems, activeItem];
}
