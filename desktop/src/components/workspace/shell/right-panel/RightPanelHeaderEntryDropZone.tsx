import { useCallback, type PointerEvent, type ReactNode } from "react";
import type { RightPanelHeaderEntryKey } from "@/lib/domain/workspaces/shell/right-panel";

interface RightPanelHeaderEntryDropZoneProps {
  entryKey: RightPanelHeaderEntryKey;
  isDragging: boolean;
  dragOffsetX: number;
  showDropIndicator: boolean;
  onRegister: (entryKey: RightPanelHeaderEntryKey, node: HTMLDivElement | null) => void;
  onPointerDown: (
    entryKey: RightPanelHeaderEntryKey,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function RightPanelHeaderEntryDropZone({
  entryKey,
  isDragging,
  dragOffsetX,
  showDropIndicator,
  onRegister,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  children,
}: RightPanelHeaderEntryDropZoneProps) {
  const setNode = useCallback(
    (node: HTMLDivElement | null) => onRegister(entryKey, node),
    [entryKey, onRegister],
  );

  return (
    <div
      ref={setNode}
      className="right-panel-header-entry-shell"
      data-dragging={isDragging ? true : undefined}
      data-drop-before={showDropIndicator ? true : undefined}
      style={isDragging ? { transform: `translateX(${dragOffsetX}px)` } : undefined}
      onPointerDown={(event) => onPointerDown(entryKey, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      {children}
    </div>
  );
}
