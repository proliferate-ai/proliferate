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

export interface TabDragUnit {
  kind: "topLevel";
  ids: string[];
}

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

export function reorderShellTabsByDrag(args: {
  orderedKeys: string[];
  draggedKey: string;
  targetKey: string;
  side: DropSide;
  unitsBySourceId: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const movingIds = args.unitsBySourceId.get(args.draggedKey) ?? [args.draggedKey];
  const targetIds = args.unitsBySourceId.get(args.targetKey) ?? [args.targetKey];

  return moveIdsByPlacement({
    orderedIds: args.orderedKeys,
    movingIds: [...movingIds],
    targetIds: [...targetIds],
    side: args.side,
  });
}

export function isSameDropPlacement(
  left: DropPlacement | null,
  right: DropPlacement | null,
): boolean {
  return left?.targetId === right?.targetId && left?.side === right?.side;
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
