import type { ShortcutDigit } from "@/lib/domain/shortcuts/matching";
import { resolveShortcutRangeDigitTarget } from "@/lib/domain/shortcuts/presentation";
import type { SidebarGroupState } from "@/lib/domain/workspaces/sidebar/sidebar-model";
import { visibleSidebarGroupItems } from "@/lib/domain/workspaces/sidebar/sidebar-visible-items";

export function visibleSidebarShortcutTargetIds(args: {
  groups: readonly SidebarGroupState[];
  collapsedRepoGroupKeys: ReadonlySet<string>;
  repoGroupsShownMore: ReadonlySet<string>;
  itemLimit: number;
}): string[] {
  const ids: string[] = [];

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
