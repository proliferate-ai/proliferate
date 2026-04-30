import {
  isSameDropPlacement,
  type DropPlacement,
} from "./drag";

export interface TabDragController {
  start: (args: { rowId: string; pointerId: number; pointerX: number }) => void;
  move: (args: { pointerId: number; pointerX: number; placement: DropPlacement | null }) => {
    draggingRowId: string | null;
    placement: DropPlacement | null;
    placementChanged: boolean;
  };
  finish: (pointerId: number) => { suppressedRowId: string | null };
  cancel: () => void;
  consumeSuppressedClick: (rowId: string) => boolean;
  clearClickSuppression: (rowId?: string) => void;
  snapshot: () => {
    pendingRowId: string | null;
    draggingRowId: string | null;
    pointerId: number | null;
  };
}

export function createTabDragController(args?: {
  thresholdPx?: number;
}): TabDragController {
  const thresholdPx = args?.thresholdPx ?? 4;
  let pending: { rowId: string; pointerId: number; pointerX: number } | null = null;
  let active: { rowId: string; pointerId: number; lastPlacement: DropPlacement | null } | null = null;
  let suppressedClickRowId: string | null = null;

  return {
    start: ({ rowId, pointerId, pointerX }) => {
      pending = { rowId, pointerId, pointerX };
      active = null;
      suppressedClickRowId = null;
    },

    move: ({ pointerId, pointerX, placement }) => {
      if (!pending || pending.pointerId !== pointerId) {
        return {
          draggingRowId: active?.rowId ?? null,
          placement: null,
          placementChanged: false,
        };
      }

      if (!active) {
        if (Math.abs(pointerX - pending.pointerX) < thresholdPx) {
          return {
            draggingRowId: null,
            placement: null,
            placementChanged: false,
          };
        }
        active = {
          rowId: pending.rowId,
          pointerId,
          lastPlacement: null,
        };
      }

      const placementChanged = !!placement && !isSameDropPlacement(active.lastPlacement, placement);
      if (placementChanged) {
        active.lastPlacement = placement;
      }

      return {
        draggingRowId: active.rowId,
        placement: placementChanged ? placement : null,
        placementChanged,
      };
    },

    finish: (pointerId) => {
      if (!pending || pending.pointerId !== pointerId) {
        return { suppressedRowId: null };
      }

      const suppressedRowId = active?.rowId ?? null;
      if (suppressedRowId) {
        suppressedClickRowId = suppressedRowId;
      }
      pending = null;
      active = null;
      return { suppressedRowId };
    },

    cancel: () => {
      pending = null;
      active = null;
      suppressedClickRowId = null;
    },

    consumeSuppressedClick: (rowId) => {
      if (suppressedClickRowId !== rowId) {
        return false;
      }
      suppressedClickRowId = null;
      return true;
    },

    clearClickSuppression: (rowId) => {
      if (!rowId || suppressedClickRowId === rowId) {
        suppressedClickRowId = null;
      }
    },

    snapshot: () => ({
      pendingRowId: pending?.rowId ?? null,
      draggingRowId: active?.rowId ?? null,
      pointerId: pending?.pointerId ?? active?.pointerId ?? null,
    }),
  };
}
