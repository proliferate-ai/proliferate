export interface SessionTabOverflowItem {
  id: string;
  width: number;
}

interface PartitionSessionTabsForOverflowArgs {
  tabs: SessionTabOverflowItem[];
  activeId: string | null;
  promotedIds?: string[];
  availableWidth: number;
  reservedWidth?: number;
  overflowControlWidth?: number;
  gapWidth?: number;
  minimumVisibleCount?: number;
}

interface PartitionSessionTabsForOverflowResult {
  visibleIds: string[];
  overflowIds: string[];
  hasOverflow: boolean;
}

interface ResolveSessionTabReservedWidthArgs {
  availableWidth: number;
  fixedControlWidth: number;
  fileTabsWidth: number;
  fileTabsMaxReserveRatio: number;
  protectedSessionWidth: number;
  overflowControlWidth?: number;
  gapWidth?: number;
}

function clampWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function totalWidth(
  ids: string[],
  widthsById: Map<string, number>,
  gapWidth: number,
): number {
  if (ids.length === 0) {
    return 0;
  }

  return ids.reduce((sum, id) => sum + (widthsById.get(id) ?? 0), 0)
    + gapWidth * (ids.length - 1);
}

function sortByInputOrder(ids: string[], orderedIds: string[]): string[] {
  const visible = new Set(ids);
  return orderedIds.filter((id) => visible.has(id));
}

function uniqueExistingIds(ids: string[], orderedIds: string[]): string[] {
  const orderedIdSet = new Set(orderedIds);
  const seen = new Set<string>();
  const next: string[] = [];

  for (const id of ids) {
    if (!orderedIdSet.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    next.push(id);
  }

  return next;
}

function ensureMinimumVisibleIds(
  visibleIds: string[],
  orderedIds: string[],
  activeVisibleId: string | null,
  minimumVisibleCount: number,
): string[] {
  if (minimumVisibleCount <= 1 || visibleIds.length >= minimumVisibleCount) {
    return visibleIds;
  }

  const next = [...visibleIds];
  const activeIndex = activeVisibleId ? orderedIds.indexOf(activeVisibleId) : -1;
  const candidates = [
    activeIndex > 0 ? orderedIds[activeIndex - 1] : null,
    activeIndex >= 0 ? orderedIds[activeIndex + 1] : null,
    ...orderedIds,
  ];

  for (const id of candidates) {
    if (!id || next.includes(id)) {
      continue;
    }
    next.push(id);
    if (next.length >= minimumVisibleCount) {
      break;
    }
  }

  return next;
}

export function resolveSessionTabReservedWidth({
  availableWidth,
  fixedControlWidth,
  fileTabsWidth,
  fileTabsMaxReserveRatio,
  protectedSessionWidth,
  overflowControlWidth = 0,
  gapWidth = 0,
}: ResolveSessionTabReservedWidthArgs): number {
  const fixedWidth = clampWidth(fixedControlWidth);
  const fileWidth = clampWidth(fileTabsWidth);
  if (fileWidth === 0) {
    return fixedWidth;
  }

  const clampedAvailableWidth = clampWidth(availableWidth);
  const maxFileReserve = Math.floor(
    clampedAvailableWidth * Math.max(0, fileTabsMaxReserveRatio),
  );
  const fileRoom = clampedAvailableWidth
    - fixedWidth
    - clampWidth(protectedSessionWidth)
    - clampWidth(overflowControlWidth);
  const visibleFileReserve = Math.min(fileWidth, maxFileReserve, Math.max(0, fileRoom));

  return fixedWidth + (visibleFileReserve > 0 ? visibleFileReserve + gapWidth : 0);
}

export function partitionSessionTabsForOverflow({
  tabs,
  activeId,
  promotedIds = [],
  availableWidth,
  reservedWidth = 0,
  overflowControlWidth = 0,
  gapWidth = 0,
  minimumVisibleCount = 1,
}: PartitionSessionTabsForOverflowArgs): PartitionSessionTabsForOverflowResult {
  const orderedIds = tabs.map((tab) => tab.id);
  if (orderedIds.length <= 1) {
    return {
      visibleIds: orderedIds,
      overflowIds: [],
      hasOverflow: false,
    };
  }

  const widthsById = new Map(
    tabs.map((tab) => [tab.id, clampWidth(tab.width)] as const),
  );
  const availableForSessions = Math.max(0, availableWidth - reservedWidth);
  if (totalWidth(orderedIds, widthsById, gapWidth) <= availableForSessions) {
    return {
      visibleIds: orderedIds,
      overflowIds: [],
      hasOverflow: false,
    };
  }

  const activeExists = activeId !== null && orderedIds.includes(activeId);
  const activeVisibleId = activeExists ? activeId : orderedIds[0] ?? null;
  const promotedVisibleIds = uniqueExistingIds(promotedIds, orderedIds);
  const protectedIds = new Set([
    ...promotedVisibleIds,
    ...(activeVisibleId ? [activeVisibleId] : []),
  ]);
  const visibleCapacity = Math.max(0, availableForSessions - overflowControlWidth);
  const visibleIds: string[] = [];

  for (const id of orderedIds) {
    const candidateIds = [...visibleIds, id];
    if (totalWidth(candidateIds, widthsById, gapWidth) <= visibleCapacity) {
      visibleIds.push(id);
    }
  }

  if (activeVisibleId && !visibleIds.includes(activeVisibleId)) {
    visibleIds.push(activeVisibleId);
  }

  for (const id of promotedVisibleIds) {
    if (!visibleIds.includes(id)) {
      visibleIds.push(id);
    }
  }

  const minimumVisible = Math.max(1, Math.min(minimumVisibleCount, orderedIds.length));
  const minimumVisibleIds = ensureMinimumVisibleIds(
    visibleIds,
    orderedIds,
    activeVisibleId,
    minimumVisible,
  );

  while (
    minimumVisibleIds.length > minimumVisible
    && totalWidth(minimumVisibleIds, widthsById, gapWidth) > visibleCapacity
  ) {
    const removeIndex = findLastRemovableIndex(
      minimumVisibleIds,
      activeVisibleId,
      protectedIds,
    );
    if (removeIndex === -1) {
      break;
    }
    minimumVisibleIds.splice(removeIndex, 1);
  }

  while (
    minimumVisibleIds.length > 1
    && totalWidth(minimumVisibleIds, widthsById, gapWidth) > visibleCapacity
  ) {
    const removeIndex = findOldestPromotedRemovableIndex(
      minimumVisibleIds,
      activeVisibleId,
      promotedVisibleIds,
    );
    if (removeIndex === -1) {
      break;
    }
    protectedIds.delete(minimumVisibleIds[removeIndex]);
    minimumVisibleIds.splice(removeIndex, 1);
  }

  const orderedVisibleIds = sortByInputOrder(minimumVisibleIds, orderedIds);
  const visibleSet = new Set(orderedVisibleIds);
  const overflowIds = orderedIds.filter((id) => !visibleSet.has(id));

  return {
    visibleIds: orderedVisibleIds,
    overflowIds,
    hasOverflow: overflowIds.length > 0,
  };
}

function findLastRemovableIndex(
  ids: string[],
  activeId: string | null,
  protectedIds: Set<string>,
): number {
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (ids[index] !== activeId && !protectedIds.has(ids[index])) {
      return index;
    }
  }

  return -1;
}

function findOldestPromotedRemovableIndex(
  ids: string[],
  activeId: string | null,
  promotedIds: string[],
): number {
  for (const promotedId of promotedIds) {
    if (promotedId === activeId) {
      continue;
    }
    const index = ids.indexOf(promotedId);
    if (index !== -1) {
      return index;
    }
  }

  return -1;
}
