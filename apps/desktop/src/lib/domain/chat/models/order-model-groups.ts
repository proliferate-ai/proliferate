import type { ModelSelectorGroup } from "@/lib/domain/chat/models/model-selector-types";

/**
 * Orders model-picker groups so the ACTIVE harness's group renders first,
 * preserving the incoming relative order of all other groups. Pure
 * presentation — never mutates the input array.
 *
 * When `activeKind` is null or matches no group, the input order is returned
 * unchanged.
 */
export function orderModelGroupsActiveFirst(
  groups: ModelSelectorGroup[],
  activeKind: string | null,
): ModelSelectorGroup[] {
  if (!activeKind) {
    return groups;
  }
  const activeIndex = groups.findIndex((group) => group.kind === activeKind);
  if (activeIndex <= 0) {
    return groups;
  }
  return [
    groups[activeIndex],
    ...groups.slice(0, activeIndex),
    ...groups.slice(activeIndex + 1),
  ];
}
