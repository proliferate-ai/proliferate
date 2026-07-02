import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
  type MouseEvent as ReactMouseEvent,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Slot } from "@radix-ui/react-slot";
import { Popover, PopoverTrigger } from "../kit/Popover";
import { useNativeOverlayRegistration } from "../overlays/overlay-presence";

type PopoverAlign = "start" | "end";
type PopoverSide = "bottom" | "top" | "right" | "left";
type PopoverPlacementSide = PopoverSide | "auto";
type PopoverTriggerMode = "click" | "doubleClick" | "contextMenu";

export const POPOVER_FRAME_CLASS =
  "m-px rounded-xl bg-popover/90 text-popover-foreground shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm";
export const POPOVER_SURFACE_CLASS = `${POPOVER_FRAME_CLASS} flex max-h-[calc(100vh-1rem)] min-w-[240px] max-w-[320px] select-none flex-col overflow-y-auto p-1`;

interface PopoverButtonProps {
  /** The trigger element — receives onClick and ref. */
  trigger: ReactElement<{
    onClick?: (...args: unknown[]) => void;
    onDoubleClick?: (...args: unknown[]) => void;
    onContextMenu?: (...args: unknown[]) => void;
    ref?: Ref<HTMLElement>;
  }>;
  /** Popover content. Receives a `close` function. */
  children: (close: () => void) => ReactNode;
  /** Horizontal alignment relative to trigger (for top/bottom sides). Default: "start". */
  align?: PopoverAlign;
  /** Which side to open on. Default: "bottom". */
  side?: PopoverPlacementSide;
  /** Gap between trigger and popover in px. Default: 4. */
  offset?: number;
  /** Class name for the popover surface. */
  className?: string;
  /** Stop click propagation on the trigger. Useful inside clickable parents. */
  stopPropagation?: boolean;
  /** Which interaction opens the popover. Default: "click". */
  triggerMode?: PopoverTriggerMode;
  /** Controlled open state. When provided, external code can open the popover. */
  externalOpen?: boolean;
  /** Called when the popover closes (for controlled mode). */
  onOpenChange?: (open: boolean) => void;
}

export function PopoverButton({
  trigger,
  children,
  align = "start",
  side = "auto",
  offset = 4,
  className = `w-56 ${POPOVER_SURFACE_CLASS}`,
  stopPropagation = false,
  triggerMode = "click",
  externalOpen,
  onOpenChange,
}: PopoverButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  // Cursor position captured by the contextMenu handler; when unset, the
  // virtual anchor falls back to the trigger element's rect (doubleClick and
  // externalOpen behave like the old trigger-rect positioning).
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const virtualAnchorRef = useRef({
    getBoundingClientRect: (): DOMRect => {
      const point = pointRef.current;
      if (point) {
        return new DOMRect(point.x, point.y, 0, 0);
      }
      return triggerRef.current?.getBoundingClientRect() ?? new DOMRect();
    },
  });
  useNativeOverlayRegistration(open);

  const setOpenAndNotify = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const close = useCallback(() => setOpenAndNotify(false), [setOpenAndNotify]);

  // Respond to external open/close requests.
  useEffect(() => {
    if (externalOpen === undefined) {
      return;
    }

    if (externalOpen && !open) {
      pointRef.current = null;
      setOpenAndNotify(true);
    } else if (!externalOpen && open) {
      setOpen(false);
    }
  }, [externalOpen, open, setOpenAndNotify]);

  const handleClick = (event: ReactMouseEvent) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
    if (triggerMode === "doubleClick") {
      pointRef.current = null;
      setOpenAndNotify(!open);
    }
  };

  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    if (stopPropagation) {
      event.stopPropagation();
    }
    if (triggerMode === "contextMenu") {
      pointRef.current =
        typeof event.clientX === "number" && typeof event.clientY === "number"
          ? { x: event.clientX, y: event.clientY }
          : null;
      setOpenAndNotify(true);
    }
  };

  return (
    // modal: parity with the old fixed-inset shield — an outside click must
    // ONLY dismiss (never also activate the element under the cursor, e.g.
    // switching workspaces while closing a row's context menu).
    <Popover open={open} onOpenChange={setOpenAndNotify} modal>
      {triggerMode === "click" ? (
        <PopoverTrigger
          asChild
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
        >
          {trigger}
        </PopoverTrigger>
      ) : (
        <>
          {/* Virtual anchor: positions the menu at the captured cursor point
              (contextMenu) or at the trigger's rect (doubleClick/externalOpen). */}
          <PopoverPrimitive.Anchor virtualRef={virtualAnchorRef} />
          <Slot
            ref={triggerRef}
            data-state={open ? "open" : "closed"}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
          >
            {trigger}
          </Slot>
        </>
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover-content"
          side={side === "auto" ? "bottom" : side}
          align={align}
          sideOffset={offset}
          // Focus neutrality (parity with the pre-Radix implementation): opening
          // must not blur the terminal/composer, and closing must not yank focus
          // back to the trigger.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className={`z-50 outline-none ${className}`}
        >
          {children(close)}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </Popover>
  );
}
