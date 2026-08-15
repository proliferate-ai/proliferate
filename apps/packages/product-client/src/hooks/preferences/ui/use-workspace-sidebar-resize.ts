import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { useResize } from "#product/hooks/ui/layout/use-resize";
import {
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "#product/lib/domain/preferences/workspace-ui/sidebar";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

interface WorkspaceSidebarResizeState {
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  sidebarResizing: boolean;
  onSidebarSeparatorDown: (event: MouseEvent) => void;
}

// Owns the shared sidebar's pointer-driven width. Live drag values stay local
// so the durable workspace-ui store (and its persistence subscriber) observes
// one completed gesture instead of every mousemove.
export function useWorkspaceSidebarResize(): WorkspaceSidebarResizeState {
  const durableSidebarWidth = useWorkspaceUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspaceUiStore((state) => state.setSidebarWidth);
  const [sessionSidebarWidth, setSessionSidebarWidth] = useState<number | null>(null);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const draggedSidebarWidthRef = useRef<number | null>(null);

  const handleSidebarResize = useCallback((width: number) => {
    draggedSidebarWidthRef.current = width;
    setSessionSidebarWidth(width);
  }, []);

  const handleSidebarResizeEnd = useCallback(() => {
    const draggedWidth = draggedSidebarWidthRef.current;
    draggedSidebarWidthRef.current = null;
    setSidebarResizing(false);

    if (
      draggedWidth !== null
      && draggedWidth !== useWorkspaceUiStore.getState().sidebarWidth
    ) {
      setSidebarWidth(draggedWidth);
    }
    setSessionSidebarWidth(null);
  }, [setSidebarWidth]);

  const beginSidebarResize = useResize({
    direction: "horizontal",
    size: sessionSidebarWidth ?? durableSidebarWidth,
    onResize: handleSidebarResize,
    onResizeEnd: handleSidebarResizeEnd,
    min: WORKSPACE_SIDEBAR_MIN_WIDTH,
    max: WORKSPACE_SIDEBAR_MAX_WIDTH,
  });

  const onSidebarSeparatorDown = useCallback((event: MouseEvent) => {
    draggedSidebarWidthRef.current = null;
    setSidebarResizing(true);
    beginSidebarResize(event);
  }, [beginSidebarResize]);

  return {
    sidebarWidth: sessionSidebarWidth ?? durableSidebarWidth,
    setSidebarWidth,
    sidebarResizing,
    onSidebarSeparatorDown,
  };
}
