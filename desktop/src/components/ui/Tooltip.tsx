import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

const VIEWPORT_MARGIN = 12;
const TOOLTIP_OFFSET = 10;

export function Tooltip({
  content,
  children,
  className = "inline-flex shrink-0",
}: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // `left` is the anchor's center x; the tooltip is rendered with
  // `-translate-x-1/2` so it sits centered above. After mount we measure
  // the actual tooltip width and clamp `left` so the *translated* tooltip
  // (left-edge = left - width/2) stays within VIEWPORT_MARGIN of both
  // viewport edges. `measured` gates the reveal so the user never sees
  // the pre-clamp position.
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [measured, setMeasured] = useState(false);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    setPosition({
      top: Math.max(VIEWPORT_MARGIN, rect.top - TOOLTIP_OFFSET),
      left: rect.left + rect.width / 2,
    });
    setMeasured(false);
  }, []);

  const show = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  const hide = useCallback(() => {
    setOpen(false);
    setMeasured(false);
  }, []);

  useLayoutEffect(() => {
    if (!open || !position || measured) {
      return;
    }
    const el = tooltipRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const halfWidth = rect.width / 2;
    const minLeft = VIEWPORT_MARGIN + halfWidth;
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - halfWidth;
    const clampedLeft = Math.min(Math.max(position.left, minLeft), maxLeft);
    if (clampedLeft !== position.left) {
      setPosition({ top: position.top, left: clampedLeft });
    }
    setMeasured(true);
  }, [open, position, measured]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleWindowChange = () => updatePosition();
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        onMouseEnter={(event: MouseEvent<HTMLSpanElement>) => {
          event.stopPropagation();
          show();
        }}
        onMouseLeave={hide}
        onFocusCapture={() => show()}
        onBlurCapture={(event: FocusEvent<HTMLSpanElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            hide();
          }
        }}
      >
        {children}
      </span>
      {open && position && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{ top: position.top, left: position.left }}
          className={`pointer-events-none fixed z-[70] max-w-[18rem] -translate-x-1/2 -translate-y-full rounded-full border border-border/60 bg-popover/96 px-2.5 py-1 text-[11px] font-medium leading-tight text-popover-foreground shadow-floating backdrop-blur-lg ${
            measured ? "opacity-100" : "opacity-0"
          }`}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
