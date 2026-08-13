import type {
  SidebarGroupState,
  SidebarWorkspaceItemState,
} from "#product/lib/domain/workspaces/sidebar/sidebar-model";

/**
 * Flattens the repo groups' visible items down to the pinned ones, ordered by
 * when they were pinned (the persisted id array's order). Deriving from the
 * groups keeps repo-group visibility semantics: an archived, filtered-out, or
 * hidden-repo workspace does not resurface in the Pinned section.
 */
export function collectPinnedSidebarItems(
  groups: SidebarGroupState[],
  pinnedWorkspaceIds: readonly string[],
): SidebarWorkspaceItemState[] {
  const pinRankById = new Map(pinnedWorkspaceIds.map((id, index) => [id, index]));
  const pinRank = (item: SidebarWorkspaceItemState): number => {
    const ranks = [item.id, item.localWorkspaceId, item.cloudWorkspaceId]
      .map((id) => (id ? pinRankById.get(id) : undefined))
      .filter((rank): rank is number => rank !== undefined);
    return ranks.length > 0 ? Math.min(...ranks) : pinnedWorkspaceIds.length;
  };
  return groups
    .flatMap((group) => group.items)
    .filter((item) => item.pinned)
    .sort((left, right) => pinRank(left) - pinRank(right));
}
