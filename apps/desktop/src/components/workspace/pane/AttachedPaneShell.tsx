import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";

type AttachedPaneSide = "left" | "right";

interface DragState {
  startX: number;
  startWidth: number;
}

export function AttachedPaneShell({
  children,
  attached,
  attachedOpen,
  side = "right",
  defaultAttachedWidth = 176,
  minAttachedWidth = 144,
  maxAttachedWidth = 320,
  resizeLabel = "Resize attached pane",
  className = "",
  contentClassName = "",
  attachedClassName = "",
}: {
  children: ReactNode;
  attached?: ReactNode;
  attachedOpen: boolean;
  side?: AttachedPaneSide;
  defaultAttachedWidth?: number;
  minAttachedWidth?: number;
  maxAttachedWidth?: number;
  resizeLabel?: string;
  className?: string;
  contentClassName?: string;
  attachedClassName?: string;
}) {
  const [attachedWidth, setAttachedWidth] = useState(defaultAttachedWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);

  const beginResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startX: event.clientX,
      startWidth: attachedWidth,
    };
    setIsDragging(true);
  }, [attachedWidth]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(event: globalThis.PointerEvent) {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const delta = side === "right"
        ? dragState.startX - event.clientX
        : event.clientX - dragState.startX;
      setAttachedWidth(clamp(
        dragState.startWidth + delta,
        minAttachedWidth,
        maxAttachedWidth,
      ));
    }

    function handlePointerUp() {
      dragStateRef.current = null;
      setIsDragging(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDragging, maxAttachedWidth, minAttachedWidth, side]);

  const content = (
    <div className={twMerge("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", contentClassName)}>
      {children}
    </div>
  );
  const resizeGutter = attachedOpen && attached ? (
    <AttachedPaneResizeGutter
      side={side}
      label={resizeLabel}
      active={isDragging}
      onPointerDown={beginResize}
    />
  ) : null;
  const attachedPane = attachedOpen && attached ? (
    <aside
      className={twMerge(
        "flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar-background",
        side === "right"
          ? "border-l border-sidebar-border/70"
          : "border-r border-sidebar-border/70",
        attachedClassName,
      )}
      style={{ width: attachedWidth }}
    >
      {attached}
    </aside>
  ) : null;

  return (
    <div className={twMerge("flex min-h-0 flex-1 overflow-hidden bg-sidebar-background", className)}>
      {side === "left" && attachedPane}
      {side === "left" && resizeGutter}
      {content}
      {side === "right" && resizeGutter}
      {side === "right" && attachedPane}
    </div>
  );
}

function AttachedPaneResizeGutter({
  side,
  label,
  active,
  onPointerDown,
}: {
  side: AttachedPaneSide;
  label: string;
  active: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={onPointerDown}
      className={twMerge(
        "group relative z-10 w-1 shrink-0 cursor-col-resize bg-sidebar-background outline-none",
        active && "bg-sidebar-accent",
      )}
    >
      <div
        className={twMerge(
          "absolute inset-y-0 w-px bg-transparent transition-colors group-hover:bg-sidebar-border group-focus:bg-sidebar-border",
          active && "bg-sidebar-border",
          side === "right" ? "right-0" : "left-0",
        )}
      />
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
