import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type MutableRefObject,
  type RefObject,
} from "react";
import {
  createTabDragController,
  type TabDragController,
} from "@/lib/domain/workspaces/tabs/drag-controller";
import {
  reorderShellTabsByDrag,
  resolveDragOffsetX,
  resolveDropTarget,
  type DragLayoutRow,
  type TabDragUnit,
} from "@/lib/domain/workspaces/tabs/drag";

export interface TabDragRow extends DragLayoutRow {
  sourceId: string;
}

interface BaseTabDragArgs {
  stripRef: RefObject<HTMLDivElement | null>;
  rows: TabDragRow[];
  orderedIds: string[];
  onReorder: (nextIds: string[]) => void;
  onDragStart?: () => void;
}

interface TabDragApi {
  stripDragProps: Pick<
    HTMLAttributes<HTMLDivElement>,
    | "onPointerDown"
    | "onPointerMove"
    | "onPointerUp"
    | "onPointerCancel"
    | "onLostPointerCapture"
  >;
  getRowDragProps: (rowId: string) => { "data-tab-drag-row-id": string };
  isDraggingRow: (rowId: string) => boolean;
  getRowDragOffset: (rowId: string) => number;
  shouldSuppressClick: (rowId: string) => boolean;
}

const EMPTY_SHELL_DRAG_UNITS = new Map<string, readonly string[]>();

export function useShellTabDrag(args: BaseTabDragArgs & {
  unitsBySourceId?: ReadonlyMap<string, readonly string[]>;
}): TabDragApi {
  const unitsBySourceIdRef = useLatestRef(
    args.unitsBySourceId ?? EMPTY_SHELL_DRAG_UNITS,
  );
  return useTabDrag({
    ...args,
    getUnit: (sourceId) => ({
      kind: "topLevel",
      ids: [...(unitsBySourceIdRef.current.get(sourceId) ?? [sourceId])],
    }),
    reorder: ({ orderedIds, draggedId, targetId, side }) =>
      reorderShellTabsByDrag({
        orderedKeys: orderedIds,
        draggedKey: draggedId,
        targetKey: targetId,
        side,
        unitsBySourceId: unitsBySourceIdRef.current,
      }),
  });
}

function useTabDrag(args: BaseTabDragArgs & {
  getUnit: (sourceId: string) => TabDragUnit | null;
  reorder: (args: {
    orderedIds: string[];
    draggedId: string;
    targetId: string;
    side: "before" | "after";
  }) => string[];
}): TabDragApi {
  const controllerRef = useRef<TabDragController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createTabDragController();
  }

  const rowsRef = useLatestRef(args.rows);
  const orderedIdsRef = useLatestRef(args.orderedIds);
  const onReorderRef = useLatestRef(args.onReorder);
  const onDragStartRef = useLatestRef(args.onDragStart);
  const getUnitRef = useLatestRef(args.getUnit);
  const reorderRef = useLatestRef(args.reorder);
  const clearClickFrameRef = useRef<number | null>(null);
  const notifiedDragStartRef = useRef(false);
  const dragVisualRef = useRef<{
    rowId: string;
    pointerId: number;
    grabOffsetX: number;
    lastPointerX: number;
  } | null>(null);
  const [dragVisual, setDragVisual] = useState<{
    rowId: string;
    offsetX: number;
  } | null>(null);

  const rowsById = useMemo(
    () => new Map(args.rows.map((row) => [row.id, row])),
    [args.rows],
  );

  const cancelClearClickFrame = useCallback(() => {
    if (clearClickFrameRef.current === null) {
      return;
    }
    window.cancelAnimationFrame(clearClickFrameRef.current);
    clearClickFrameRef.current = null;
  }, []);

  const cancelDrag = useCallback(() => {
    controllerRef.current?.cancel();
    notifiedDragStartRef.current = false;
    dragVisualRef.current = null;
    setDragVisual(null);
    cancelClearClickFrame();
  }, [cancelClearClickFrame]);

  const releasePointerCapture = useCallback((pointerId: number) => {
    const strip = args.stripRef.current;
    if (!strip?.hasPointerCapture(pointerId)) {
      return;
    }
    strip.releasePointerCapture(pointerId);
  }, [args.stripRef]);

  const getLocalPointerX = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const strip = args.stripRef.current;
    if (!strip) {
      return null;
    }
    const rect = strip.getBoundingClientRect();
    return event.clientX - rect.left + strip.scrollLeft;
  }, [args.stripRef]);

  const scheduleClickSuppressionClear = useCallback((rowId: string) => {
    cancelClearClickFrame();
    clearClickFrameRef.current = window.requestAnimationFrame(() => {
      controllerRef.current?.clearClickSuppression(rowId);
      clearClickFrameRef.current = null;
    });
  }, [cancelClearClickFrame]);

  const stripDragProps = useMemo<TabDragApi["stripDragProps"]>(() => ({
    onPointerDown: (event) => {
      if (!event.isPrimary || event.button !== 0 || shouldIgnorePointerTarget(event.target)) {
        return;
      }
      const rowId = findRowId(event.target);
      if (!rowId || !rowsRef.current.some((row) => row.id === rowId)) {
        return;
      }
      const pointerX = getLocalPointerX(event);
      if (pointerX === null) {
        return;
      }
      const row = rowsRef.current.find((candidate) => candidate.id === rowId);
      if (!row) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      notifiedDragStartRef.current = false;
      dragVisualRef.current = {
        rowId,
        pointerId: event.pointerId,
        grabOffsetX: pointerX - row.left,
        lastPointerX: pointerX,
      };
      controllerRef.current?.start({
        rowId,
        pointerId: event.pointerId,
        pointerX,
      });
    },

    onPointerMove: (event) => {
      const pointerX = getLocalPointerX(event);
      if (pointerX === null) {
        return;
      }
      const placement = resolveDropTarget({
        pointerX,
        rows: rowsRef.current,
      });
      const result = controllerRef.current?.move({
        pointerId: event.pointerId,
        pointerX,
        placement,
      });
      if (!result) {
        return;
      }
      if (result.draggingRowId) {
        if (!notifiedDragStartRef.current) {
          notifiedDragStartRef.current = true;
          onDragStartRef.current?.();
        }
        const visual = dragVisualRef.current;
        const draggedRow = rowsRef.current.find((row) => row.id === result.draggingRowId);
        if (!visual || visual.rowId !== result.draggingRowId || !draggedRow) {
          cancelDrag();
          return;
        }
        visual.lastPointerX = pointerX;
        setDragVisual({
          rowId: result.draggingRowId,
          offsetX: resolveDragOffsetX({
            pointerX,
            grabOffsetX: visual.grabOffsetX,
            currentLeft: draggedRow.left,
          }),
        });
        event.preventDefault();
      } else {
        setDragVisual(null);
      }
      if (!result.placementChanged || !result.placement || !result.draggingRowId) {
        return;
      }

      const draggedRow = rowsRef.current.find((row) => row.id === result.draggingRowId);
      const targetRow = rowsRef.current.find((row) => row.id === result.placement?.targetId);
      if (!draggedRow || !targetRow) {
        cancelDrag();
        return;
      }

      const next = reorderRef.current({
        orderedIds: orderedIdsRef.current,
        draggedId: draggedRow.sourceId,
        targetId: targetRow.sourceId,
        side: result.placement.side,
      });
      if (!sameStringArray(next, orderedIdsRef.current)) {
        onReorderRef.current(next);
      }
    },

    onPointerUp: (event) => {
      const result = controllerRef.current?.finish(event.pointerId);
      releasePointerCapture(event.pointerId);
      notifiedDragStartRef.current = false;
      dragVisualRef.current = null;
      setDragVisual(null);
      if (result?.suppressedRowId) {
        scheduleClickSuppressionClear(result.suppressedRowId);
        event.preventDefault();
      }
    },

    onPointerCancel: (event) => {
      releasePointerCapture(event.pointerId);
      cancelDrag();
    },

    onLostPointerCapture: () => {
      cancelDrag();
    },
  }), [
    cancelDrag,
    getLocalPointerX,
    onReorderRef,
    onDragStartRef,
    orderedIdsRef,
    releasePointerCapture,
    reorderRef,
    rowsRef,
    scheduleClickSuppressionClear,
  ]);

  const getRowDragProps = useCallback((rowId: string) => ({
    "data-tab-drag-row-id": rowId,
  }), []);

  const isDraggingRow = useCallback((rowId: string) => {
    if (!dragVisual) {
      return false;
    }
    const draggingSourceId = rowsById.get(dragVisual.rowId)?.sourceId;
    const rowSourceId = rowsById.get(rowId)?.sourceId;
    if (!draggingSourceId || !rowSourceId) {
      return false;
    }
    const unit = getUnitRef.current(draggingSourceId);
    return unit?.ids.includes(rowSourceId) ?? false;
  }, [dragVisual, getUnitRef, rowsById]);

  const getRowDragOffset = useCallback((rowId: string) => {
    if (!dragVisual || !isDraggingRow(rowId)) {
      return 0;
    }
    return dragVisual.offsetX;
  }, [dragVisual, isDraggingRow]);

  const shouldSuppressClick = useCallback((rowId: string) => {
    const didSuppress = controllerRef.current?.consumeSuppressedClick(rowId) ?? false;
    if (didSuppress) {
      cancelClearClickFrame();
    }
    return didSuppress;
  }, [cancelClearClickFrame]);

  useLayoutEffect(() => {
    const snapshot = controllerRef.current?.snapshot();
    if (!snapshot?.pendingRowId && !snapshot?.draggingRowId) {
      return;
    }
    const rowIds = new Set(args.rows.map((row) => row.id));
    if (
      args.rows.length === 0
      || (snapshot.pendingRowId && !rowIds.has(snapshot.pendingRowId))
      || (snapshot.draggingRowId && !rowIds.has(snapshot.draggingRowId))
    ) {
      cancelDrag();
      return;
    }

    const visual = dragVisualRef.current;
    if (!visual || !snapshot.draggingRowId) {
      return;
    }
    const row = args.rows.find((candidate) => candidate.id === visual.rowId);
    if (!row) {
      cancelDrag();
      return;
    }
    const offsetX = resolveDragOffsetX({
      pointerX: visual.lastPointerX,
      grabOffsetX: visual.grabOffsetX,
      currentLeft: row.left,
    });
    setDragVisual((current) => {
      if (current?.rowId === visual.rowId && current.offsetX === offsetX) {
        return current;
      }
      return { rowId: visual.rowId, offsetX };
    });
  }, [args.rows, cancelDrag]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelDrag();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cancelDrag();
    };
  }, [cancelDrag]);

  return {
    stripDragProps,
    getRowDragProps,
    isDraggingRow,
    getRowDragOffset,
    shouldSuppressClick,
  };
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function shouldIgnorePointerTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && !!target.closest("[data-tab-drag-ignore='true']");
}

function findRowId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLElement>("[data-tab-drag-row-id]")?.dataset.tabDragRowId ?? null;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
