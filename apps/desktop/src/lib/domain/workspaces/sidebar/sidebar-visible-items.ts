import type { SidebarGroupState } from "@/lib/domain/workspaces/sidebar/sidebar-model";

export function visibleSidebarGroupItems(args: {
  group: SidebarGroupState;
  isShownMore: boolean;
  itemLimit: number;
}): SidebarGroupState["items"] {
  const { group, isShownMore, itemLimit } = args;
  if (isShownMore || group.items.length <= itemLimit) {
    return group.items;
  }

  const visibleItems = group.items.slice(0, itemLimit);
  const activeItem = group.items.find((item) => item.active);
  if (!activeItem || visibleItems.some((item) => item.id === activeItem.id)) {
    return visibleItems;
  }

  return [...visibleItems, activeItem];
}
