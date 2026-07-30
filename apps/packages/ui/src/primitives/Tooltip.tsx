import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Tooltip as KitTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip-primitive";

/**
 * How long a press suppresses the tooltip's dismissal. Long enough to span a
 * real press (pointer-down through the click that follows it), short enough
 * that a press which never produces a click cannot pin the tooltip open for a
 * user-perceptible moment. Not a motion value — nothing animates for this
 * long — so it stays local rather than entering the motion token set.
 */
const PRESS_SUPPRESSION_MS = 400;

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  singleLine?: boolean;
  /**
   * Keeps the tooltip open while the trigger is pressed. By default the
   * underlying primitive dismisses on pointer-down, which is right for a
   * trigger that opens something (the tooltip would cover it) but wrong for a
   * control you click repeatedly in place — a stepper whose tooltip reports
   * the value you are stepping must stay legible across the click, not blink
   * out on every press. Only the press itself is suppressed, and only for
   * `PRESS_SUPPRESSION_MS`: Escape, any other keystroke, trigger blur, and
   * pointer-leave all still dismiss it, including mid-press. Touch keeps the
   * primitive's default dismissal.
   */
  keepOpenOnPress?: boolean;
  /**
   * Controls visibility from outside. When provided, the caller's value is
   * the only input the primitive sees: hover, focus, and the press machinery
   * above all stand down, so internal state can never disagree with it.
   */
  open?: boolean;
  /**
   * Hover delay before opening, in ms. Defaults to 0 — these tooltips label
   * controls, and a label should answer immediately.
   */
  delayDuration?: number;
}

export function Tooltip({
  content,
  children,
  className = "inline-flex shrink-0",
  singleLine = false,
  keepOpenOnPress = false,
  open,
  delayDuration = 0,
}: TooltipProps) {
  const [hoverOpen, setHoverOpen] = useState(false);
  // A caller-supplied `open` wins outright: the press machinery exists to
  // reinterpret pointer intent, and a controlled tooltip leaves no intent to
  // reinterpret — running it anyway would only fight the caller's value.
  const pressManaged = keepOpenOnPress && open === undefined;
  // Only the close request raised by pressing the trigger is suppressed.
  // Ignoring *every* close request would also swallow Escape and trigger blur,
  // the only ways a keyboard or switch-access user has to dismiss hover/focus
  // content (WCAG 1.4.13).
  //
  // The suppression is a deadline, not a latch. A latch cleared by some later
  // event ("the click", "the pointerup") is only as good as its clear-paths,
  // and a press does not reliably produce any particular one: drag a few pixels
  // off the trigger and no `click` is dispatched, right-click dispatches
  // `contextmenu` instead, a cancelled gesture may deliver nothing. Every miss
  // left the tooltip pinned open with Escape dead — worse than the blink it was
  // added to prevent. A deadline cannot be missed: the suppression expires on
  // its own whether or not the matching event ever arrives.
  const pressUntilRef = useRef(0);
  const suppressingPress = () => pressUntilRef.current > performance.now();

  useEffect(() => {
    if (!pressManaged) return;
    // Any keystroke ends the press window immediately, so Escape is never
    // swallowed even mid-press. Capture phase: the dismissable layer's own
    // Escape handling listens on the document, and this must run first.
    const endPress = () => {
      pressUntilRef.current = 0;
    };
    window.addEventListener("keydown", endPress, { capture: true });
    window.addEventListener("pointercancel", endPress);
    return () => {
      window.removeEventListener("keydown", endPress, { capture: true });
      window.removeEventListener("pointercancel", endPress);
    };
  }, [pressManaged]);

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) {
      setHoverOpen(true);
      return;
    }
    if (suppressingPress()) return;
    setHoverOpen(false);
  }, []);

  const controlled = open !== undefined
    ? { open }
    : pressManaged
      ? { open: hoverOpen, onOpenChange: handleOpenChange }
      : {};

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <KitTooltip {...controlled}>
        <TooltipTrigger asChild>
          <span
            className={className}
            // Capture phase: the primitive raises its close request from its
            // own pointer-down handler on the inner trigger, which in the
            // bubble phase would run before this one and close first.
            onPointerDownCapture={pressManaged
              ? (event) => {
                // Touch keeps the primitive's own behavior (see onPointerEnter),
                // so there is nothing to suppress and no window to open.
                if (event.pointerType === "touch") return;
                pressUntilRef.current = performance.now() + PRESS_SUPPRESSION_MS;
              }
              : undefined}
            onPointerEnter={pressManaged
              ? (event) => {
                // Touch fires `pointerenter` but never `pointerleave`, so
                // opening here would pin the tooltip open on a tap with no way
                // to dismiss it — the primitive closes on pointer-down instead,
                // which is the behavior a touch-only user can actually reach.
                if (event.pointerType === "touch") return;
                setHoverOpen(true);
              }
              : undefined}
            onPointerLeave={pressManaged
              ? () => {
                pressUntilRef.current = 0;
                setHoverOpen(false);
              }
              : undefined}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          sideOffset={10}
          collisionPadding={12}
          style={
            singleLine
              ? undefined
              : {
                boxSizing: "border-box",
                maxWidth: "min(22rem, calc(100vw - 1.5rem))",
                overflowWrap: "anywhere",
                whiteSpace: "normal",
                wordBreak: "break-word",
              }
          }
          className={
            singleLine
              ? "z-tooltip max-w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden text-ellipsis whitespace-nowrap rounded-full"
              : "z-tooltip overflow-hidden rounded-lg text-left"
          }
        >
          {singleLine
            ? content
            : content.split("\n").map((line, index) => (
              <span
                key={`${index}-${line}`}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  overflowWrap: "anywhere",
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                }}
              >
                {line}
              </span>
            ))}
        </TooltipContent>
      </KitTooltip>
    </TooltipProvider>
  );
}
