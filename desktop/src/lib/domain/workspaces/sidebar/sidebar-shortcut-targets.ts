import type { ShortcutDigit } from "@/lib/domain/shortcuts/matching";
import type { SidebarGroupState } from "@/lib/domain/workspaces/sidebar/sidebar";

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

    const visibleItems = args.repoGroupsShownMore.has(group.sourceRoot)
      ? group.items
      : group.items.slice(0, args.itemLimit);
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
  const index = digit === 9 ? targetIds.length - 1 : digit - 1;
  return targetIds[index] ?? null;
}
