import type { ShortcutDigit } from "#product/lib/domain/shortcuts/matching";
import { resolveShortcutRangeDigitTarget } from "#product/lib/domain/shortcuts/range";
import type { SidebarGroupState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import { collectPinnedSidebarItems } from "#product/lib/domain/workspaces/sidebar/sidebar-pinned";
import { visibleSidebarGroupItems } from "#product/lib/domain/workspaces/sidebar/sidebar-visible-items";

export function visibleSidebarShortcutTargetIds(args: {
  groups: readonly SidebarGroupState[];
  collapsedRepoGroupKeys: ReadonlySet<string>;
  repoGroupsShownMore: ReadonlySet<string>;
  itemLimit: number;
  repositoriesCollapsed: boolean;
}): string[] {
  if (args.repositoriesCollapsed) {
    return [];
  }
  const ids: string[] = [];

  for (const group of args.groups) {
    if (args.collapsedRepoGroupKeys.has(group.sourceRoot)) {
      continue;
    }

    const visibleItems = visibleShortcutGroupInventory({
      group,
      isShownMore: args.repoGroupsShownMore.has(group.sourceRoot),
      itemLimit: args.itemLimit,
    });
    for (const item of visibleItems) {
      ids.push(item.id);
    }
  }

  return ids;
}

export function numberedSidebarShortcutTargetIds(args: {
  groups: readonly SidebarGroupState[];
  pinnedWorkspaceIds: readonly string[];
  collapsedRepoGroupKeys: ReadonlySet<string>;
  repoGroupsShownMore: ReadonlySet<string>;
  itemLimit: number;
  repositoriesCollapsed: boolean;
}): string[] {
  const ids = collectPinnedSidebarItems(args.groups, args.pinnedWorkspaceIds)
    .map((item) => item.id);

  if (args.repositoriesCollapsed) {
    return ids;
  }

  for (const group of args.groups) {
    if (args.collapsedRepoGroupKeys.has(group.sourceRoot)) {
      continue;
    }

    const visibleItems = visibleSidebarGroupItems({
      group,
      isShownMore: args.repoGroupsShownMore.has(group.sourceRoot),
      itemLimit: args.itemLimit,
    });
    for (const item of visibleItems) {
      ids.push(item.id);
    }
  }

  return ids;
}

function visibleShortcutGroupInventory(args: {
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

export function resolveSidebarShortcutDigitTarget(
  targetIds: readonly string[],
  digit: ShortcutDigit,
): string | null {
  return resolveShortcutRangeDigitTarget(targetIds, digit);
}

export function resolveAdjacentSidebarShortcutTarget(
  targetIds: readonly string[],
  currentTargetId: string | null | undefined,
  delta: -1 | 1,
): string | null {
  if (targetIds.length === 0) {
    return null;
  }

  const currentIndex = currentTargetId
    ? targetIds.indexOf(currentTargetId)
    : -1;
  if (currentIndex < 0) {
    return delta < 0
      ? targetIds[targetIds.length - 1] ?? null
      : targetIds[0] ?? null;
  }

  const nextIndex = (currentIndex + delta + targetIds.length) % targetIds.length;
  return targetIds[nextIndex] ?? null;
}
