import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { FixedPositionLayer } from "@/components/ui/layout/FixedPositionLayer";
import { useNativeOverlayRegistration } from "@/hooks/ui/use-native-overlay-presence";

type PopoverAlign = "start" | "end";
type PopoverSide = "bottom" | "top" | "right" | "left";
type PopoverPlacementSide = PopoverSide | "auto";
type PopoverTriggerMode = "click" | "doubleClick" | "contextMenu";

const DEFAULT_AUTO_VERTICAL_SPACE = 320;

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
  side = "bottom",
  offset = 4,
  className = "w-56 rounded-xl border border-border bg-popover p-1 shadow-floating",
  stopPropagation = false,
  triggerMode = "click",
  externalOpen,
  onOpenChange,
}: PopoverButtonProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Record<string, number>>({});
  const triggerRef = useRef<HTMLElement>(null);
  useNativeOverlayRegistration(open);

  const setOpenAndNotify = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const close = useCallback(() => setOpenAndNotify(false), [setOpenAndNotify]);

  const openFromTrigger = useCallback((cursorPos?: { x: number; y: number }) => {
    if (cursorPos) {
      setPos({ top: cursorPos.y, left: cursorPos.x });
      setOpenAndNotify(true);
    } else if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos(computePosition(rect, side, align, offset));
      setOpenAndNotify(true);
    }
  }, [align, offset, side, setOpenAndNotify]);

  const toggle = useCallback(() => {
    if (open) {
      setOpenAndNotify(false);
      return;
    }
    openFromTrigger();
  }, [open, openFromTrigger, setOpenAndNotify]);

  // Respond to external open/close requests
  const openedExternallyRef = useRef(false);

  useEffect(() => {
    if (externalOpen && !open) {
      openedExternallyRef.current = true;
      openFromTrigger();
    } else if (!externalOpen && open && openedExternallyRef.current) {
      openedExternallyRef.current = false;
      setOpenAndNotify(false);
    }
  }, [externalOpen, open, openFromTrigger, setOpenAndNotify]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAndNotify(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, setOpenAndNotify]);

  const triggerWithRef = isValidElement(trigger)
    ? cloneElement(trigger, {
        ...trigger.props,
        ref: triggerRef,
        "data-state": open ? "open" : "closed",
        onClick: (...args: unknown[]) => {
          if (stopPropagation && args[0] && typeof (args[0] as Event).stopPropagation === "function") {
            (args[0] as Event).stopPropagation();
          }
          trigger.props.onClick?.(...args);
          if (triggerMode === "click") {
            toggle();
          }
        },
        onDoubleClick: (...args: unknown[]) => {
          if (stopPropagation && args[0] && typeof (args[0] as Event).stopPropagation === "function") {
            (args[0] as Event).stopPropagation();
          }
          trigger.props.onDoubleClick?.(...args);
          if (triggerMode === "doubleClick") {
            toggle();
          }
        },
        onContextMenu: (...args: unknown[]) => {
          const event = args[0];
          if (event && typeof (event as Event).preventDefault === "function") {
            (event as Event).preventDefault();
          }
          if (stopPropagation && event && typeof (event as Event).stopPropagation === "function") {
            (event as Event).stopPropagation();
          }
          trigger.props.onContextMenu?.(...args);
          if (triggerMode === "contextMenu") {
            const me = event as MouseEvent;
            openFromTrigger(
              typeof me.clientX === "number" && typeof me.clientY === "number"
                ? { x: me.clientX, y: me.clientY }
                : undefined,
            );
          }
        },
      } as Record<string, unknown>)
    : trigger;

  return (
    <>
      {triggerWithRef}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={close} />
          <FixedPositionLayer
            className={`fixed z-50 ${className}`}
            position={pos}
          >
            {children(close)}
          </FixedPositionLayer>
        </>,
        document.body,
      )}
    </>
  );
}

function computePosition(
  rect: DOMRect,
  side: PopoverPlacementSide,
  align: PopoverAlign,
  offset: number,
): Record<string, number> {
  const resolvedSide = side === "auto"
    ? resolveAutoSide(rect, offset)
    : side;

  switch (resolvedSide) {
    case "bottom":
      return align === "end"
        ? { top: rect.bottom + offset, right: window.innerWidth - rect.right }
        : { top: rect.bottom + offset, left: rect.left };
    case "top":
      return align === "end"
        ? { bottom: window.innerHeight - rect.top + offset, right: window.innerWidth - rect.right }
        : { bottom: window.innerHeight - rect.top + offset, left: rect.left };
    case "right":
      return { top: rect.top, left: rect.right + offset };
    case "left":
      return { top: rect.top, right: window.innerWidth - rect.left + offset };
  }
}

function resolveAutoSide(rect: DOMRect, offset: number): PopoverSide {
  const spaceBelow = window.innerHeight - rect.bottom - offset;
  const spaceAbove = rect.top - offset;
  return spaceBelow < DEFAULT_AUTO_VERTICAL_SPACE && spaceAbove > spaceBelow
    ? "top"
    : "bottom";
}
