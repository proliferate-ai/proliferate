import { collectGroupIds } from "@/lib/domain/workspaces/tabs/visibility";

export type DropSide = "before" | "after";

export interface DragLayoutRow {
  id: string;
  left: number;
  width: number;
}

export interface DropPlacement {
  targetId: string;
  side: DropSide;
}

export type TabDragUnit =
  | { kind: "topLevel"; ids: string[] }
  | { kind: "child"; childId: string; parentId: string };

export function resolveDropSide(args: {
  pointerX: number;
  targetLeft: number;
  targetWidth: number;
}): DropSide {
  return args.pointerX < args.targetLeft + args.targetWidth / 2 ? "before" : "after";
}

export function resolveDropTarget(args: {
  pointerX: number;
  rows: DragLayoutRow[];
}): DropPlacement | null {
  const rows = args.rows
    .filter((row) => row.width > 0)
    .slice()
    .sort((left, right) => left.left - right.left);
  if (rows.length === 0) {
    return null;
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstRight = first.left + first.width;
  const lastRight = last.left + last.width;

  if (args.pointerX <= first.left) {
    return { targetId: first.id, side: "before" };
  }
  if (args.pointerX >= lastRight) {
    return { targetId: last.id, side: "after" };
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const right = row.left + row.width;
    if (args.pointerX >= row.left && args.pointerX <= right) {
      return {
        targetId: row.id,
        side: resolveDropSide({
          pointerX: args.pointerX,
          targetLeft: row.left,
          targetWidth: row.width,
        }),
      };
    }

    const next = rows[index + 1];
    if (!next || args.pointerX <= right || args.pointerX >= next.left) {
      continue;
    }
    const gapMidpoint = right + (next.left - right) / 2;
    return args.pointerX < gapMidpoint
      ? { targetId: row.id, side: "after" }
      : { targetId: next.id, side: "before" };
  }

  return args.pointerX < firstRight
    ? { targetId: first.id, side: "before" }
    : { targetId: last.id, side: "after" };
}

export function resolveDragOffsetX(args: {
  pointerX: number;
  grabOffsetX: number;
  currentLeft: number;
}): number {
  return args.pointerX - args.grabOffsetX - args.currentLeft;
}

export function buildChatDragUnit(args: {
  sourceId: string;
  orderedIds: string[];
  childToParent: Map<string, string>;
}): TabDragUnit | null {
  if (!args.orderedIds.includes(args.sourceId)) {
    return null;
  }

  const parentId = args.childToParent.get(args.sourceId);
  if (parentId) {
    return {
      kind: "child",
      childId: args.sourceId,
      parentId,
    };
  }

  return {
    kind: "topLevel",
    ids: collectGroupIds({
      rootSessionId: args.sourceId,
      visibleIds: args.orderedIds,
      childToParent: args.childToParent,
    }),
  };
}

export function reorderChatTabsByDrag(args: {
  orderedIds: string[];
  draggedId: string;
  targetId: string;
  side: DropSide;
  childToParent: Map<string, string>;
}): string[] {
  if (args.draggedId === args.targetId) {
    return args.orderedIds;
  }

  const draggedUnit = buildChatDragUnit({
    sourceId: args.draggedId,
    orderedIds: args.orderedIds,
    childToParent: args.childToParent,
  });
  if (!draggedUnit) {
    return args.orderedIds;
  }

  if (draggedUnit.kind === "child") {
    return reorderChildWithinGroup({
      orderedIds: args.orderedIds,
      childId: draggedUnit.childId,
      parentId: draggedUnit.parentId,
      targetId: args.targetId,
      side: args.side,
      childToParent: args.childToParent,
    });
  }

  const targetParentId = args.childToParent.get(args.targetId);
  const targetRootId = targetParentId ?? args.targetId;
  const targetIds = collectGroupIds({
    rootSessionId: targetRootId,
    visibleIds: args.orderedIds,
    childToParent: args.childToParent,
  });

  return moveIdsByPlacement({
    orderedIds: args.orderedIds,
    movingIds: draggedUnit.ids,
    targetIds,
    side: args.side,
  });
}

export function reorderFileTabsByDrag(args: {
  orderedPaths: string[];
  draggedPath: string;
  targetPath: string;
  side: DropSide;
}): string[] {
  if (args.draggedPath === args.targetPath) {
    return args.orderedPaths;
  }

  return moveIdsByPlacement({
    orderedIds: args.orderedPaths,
    movingIds: [args.draggedPath],
    targetIds: [args.targetPath],
    side: args.side,
  });
}

export function isSameDropPlacement(
  left: DropPlacement | null,
  right: DropPlacement | null,
): boolean {
  return left?.targetId === right?.targetId && left?.side === right?.side;
}

function reorderChildWithinGroup(args: {
  orderedIds: string[];
  childId: string;
  parentId: string;
  targetId: string;
  side: DropSide;
  childToParent: Map<string, string>;
}): string[] {
  if (args.childToParent.get(args.targetId) !== args.parentId) {
    return args.orderedIds;
  }

  const siblingIds = args.orderedIds.filter(
    (id) => args.childToParent.get(id) === args.parentId,
  );
  if (!siblingIds.includes(args.childId) || !siblingIds.includes(args.targetId)) {
    return args.orderedIds;
  }

  const nextSiblingIds = moveIdsByPlacement({
    orderedIds: siblingIds,
    movingIds: [args.childId],
    targetIds: [args.targetId],
    side: args.side,
  });
  if (nextSiblingIds === siblingIds) {
    return args.orderedIds;
  }

  let siblingIndex = 0;
  return args.orderedIds.map((id) => {
    if (args.childToParent.get(id) !== args.parentId) {
      return id;
    }
    return nextSiblingIds[siblingIndex++] ?? id;
  });
}

function moveIdsByPlacement(args: {
  orderedIds: string[];
  movingIds: string[];
  targetIds: string[];
  side: DropSide;
}): string[] {
  const movingSet = new Set(args.movingIds);
  const targetSet = new Set(args.targetIds);
  if (
    args.movingIds.length === 0
    || args.targetIds.length === 0
    || args.movingIds.some((id) => targetSet.has(id))
  ) {
    return args.orderedIds;
  }

  const withoutMoving = args.orderedIds.filter((id) => !movingSet.has(id));
  const targetIndexes = args.targetIds
    .map((id) => withoutMoving.indexOf(id))
    .filter((index) => index >= 0);
  if (targetIndexes.length === 0) {
    return args.orderedIds;
  }

  const insertIndex = args.side === "before"
    ? Math.min(...targetIndexes)
    : Math.max(...targetIndexes) + 1;
  const next = [
    ...withoutMoving.slice(0, insertIndex),
    ...args.movingIds,
    ...withoutMoving.slice(insertIndex),
  ];

  return sameStringArray(next, args.orderedIds) ? args.orderedIds : next;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
