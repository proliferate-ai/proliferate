import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { RightPanelHeaderEntryKey } from "@/lib/domain/workspaces/shell/right-panel-model";

const HEADER_DRAG_THRESHOLD_PX = 4;

interface HeaderDragSession {
  key: RightPanelHeaderEntryKey;
  pointerId: number;
  startX: number;
  startY: number;
  beforeKey: RightPanelHeaderEntryKey | null;
  isDragging: boolean;
}

interface HeaderDragPreview {
  key: RightPanelHeaderEntryKey;
  offsetX: number;
  beforeKey: RightPanelHeaderEntryKey | null;
}

export interface RightPanelHeaderEntryDragState {
  isDragging: boolean;
  dragOffsetX: number;
  showDropIndicator: boolean;
}

export interface RightPanelHeaderDragController {
  draggedHeaderKey: RightPanelHeaderEntryKey | null;
  showEndDropIndicator: boolean;
  getEntryDragState(entryKey: RightPanelHeaderEntryKey): RightPanelHeaderEntryDragState;
  registerHeaderEntryNode(entryKey: RightPanelHeaderEntryKey, node: HTMLDivElement | null): void;
  handleHeaderPointerDown(
    entryKey: RightPanelHeaderEntryKey,
    event: PointerEvent<HTMLDivElement>,
  ): void;
  handleHeaderPointerMove(event: PointerEvent<HTMLDivElement>): void;
  finishHeaderPointerDrag(event: PointerEvent<HTMLDivElement>): void;
  cancelHeaderPointerDrag(event: PointerEvent<HTMLDivElement>): void;
  shouldSuppressHeaderClick(): boolean;
}

export function useRightPanelHeaderDrag({
  onReorderHeaderEntry,
}: {
  onReorderHeaderEntry: (
    entryKey: RightPanelHeaderEntryKey,
    beforeEntryKey: RightPanelHeaderEntryKey | null,
  ) => void;
}): RightPanelHeaderDragController {
  const [headerDragPreview, setHeaderDragPreview] = useState<HeaderDragPreview | null>(null);
  const headerEntryNodesRef = useRef(new Map<RightPanelHeaderEntryKey, HTMLDivElement>());
  const headerDragSessionRef = useRef<HeaderDragSession | null>(null);
  const suppressNextHeaderClickRef = useRef(false);

  const registerHeaderEntryNode = useCallback((
    entryKey: RightPanelHeaderEntryKey,
    node: HTMLDivElement | null,
  ) => {
    if (node) {
      headerEntryNodesRef.current.set(entryKey, node);
      return;
    }
    headerEntryNodesRef.current.delete(entryKey);
  }, []);

  const resolveHeaderDropBeforeKey = useCallback((
    clientX: number,
    draggedKey: RightPanelHeaderEntryKey,
  ): RightPanelHeaderEntryKey | null => {
    const candidates = [...headerEntryNodesRef.current.entries()]
      .filter(([entryKey]) => entryKey !== draggedKey)
      .map(([entryKey, node]) => ({
        entryKey,
        rect: node.getBoundingClientRect(),
      }))
      .sort((left, right) => left.rect.left - right.rect.left);

    const target = candidates.find(({ rect }) => clientX < rect.left + rect.width / 2);
    return target?.entryKey ?? null;
  }, []);

  const suppressNextHeaderClick = useCallback(() => {
    suppressNextHeaderClickRef.current = true;
    window.setTimeout(() => {
      suppressNextHeaderClickRef.current = false;
    }, 50);
  }, []);

  const shouldSuppressHeaderClick = useCallback(() => {
    if (!suppressNextHeaderClickRef.current) {
      return false;
    }
    suppressNextHeaderClickRef.current = false;
    return true;
  }, []);

  const handleHeaderPointerDown = useCallback((
    entryKey: RightPanelHeaderEntryKey,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-right-panel-tab-no-drag='true']")) {
      return;
    }

    headerDragSessionRef.current = {
      key: entryKey,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      beforeKey: null,
      isDragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleHeaderPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = headerDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (!session.isDragging) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance < HEADER_DRAG_THRESHOLD_PX) {
        return;
      }
      session.isDragging = true;
    }

    event.preventDefault();
    const beforeKey = resolveHeaderDropBeforeKey(event.clientX, session.key);
    session.beforeKey = beforeKey;
    setHeaderDragPreview({
      key: session.key,
      offsetX: event.clientX - session.startX,
      beforeKey,
    });
  }, [resolveHeaderDropBeforeKey]);

  const finishHeaderPointerDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = headerDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (session.isDragging) {
      event.preventDefault();
      onReorderHeaderEntry(session.key, session.beforeKey);
      suppressNextHeaderClick();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    headerDragSessionRef.current = null;
    setHeaderDragPreview(null);
  }, [onReorderHeaderEntry, suppressNextHeaderClick]);

  const cancelHeaderPointerDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = headerDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    headerDragSessionRef.current = null;
    setHeaderDragPreview(null);
  }, []);

  const getEntryDragState = useCallback((entryKey: RightPanelHeaderEntryKey) => {
    const isDragging = headerDragPreview?.key === entryKey;
    return {
      isDragging,
      dragOffsetX: isDragging ? headerDragPreview.offsetX : 0,
      showDropIndicator: headerDragPreview?.beforeKey === entryKey,
    };
  }, [headerDragPreview]);

  return {
    draggedHeaderKey: headerDragPreview?.key ?? null,
    showEndDropIndicator: headerDragPreview?.beforeKey === null,
    getEntryDragState,
    registerHeaderEntryNode,
    handleHeaderPointerDown,
    handleHeaderPointerMove,
    finishHeaderPointerDrag,
    cancelHeaderPointerDrag,
    shouldSuppressHeaderClick,
  };
}
