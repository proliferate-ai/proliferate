import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Tooltip as KitTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip-primitive";

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
   * out on every press. Only the press itself is suppressed: Escape, trigger
   * blur, and pointer-leave all still dismiss it.
   */
  keepOpenOnPress?: boolean;
}

export function Tooltip({
  content,
  children,
  className = "inline-flex shrink-0",
  singleLine = false,
  keepOpenOnPress = false,
}: TooltipProps) {
  const [hoverOpen, setHoverOpen] = useState(false);
  // Only the close request raised by pressing the trigger is suppressed —
  // narrowly, and only while a press is actually in flight. Ignoring *every*
  // close request would also swallow Escape and trigger blur, which are the
  // only ways a keyboard user has to dismiss hover/focus content (WCAG 1.4.13);
  // that left the tooltip stuck open with no pointer-free way out.
  const pressingRef = useRef(false);
  useEffect(() => {
    if (!keepOpenOnPress) return;
    const endPress = () => {
      pressingRef.current = false;
    };
    // The press window closes on `click`, not `pointerup`: the primitive
    // requests a close from both pointer-down *and* click, and click is
    // dispatched after pointer-up, so clearing any earlier would let the
    // click's request through and reintroduce the blink. Listened for on the
    // window in the bubble phase so it runs after the trigger's own handlers,
    // and so a press released off-trigger still clears.
    window.addEventListener("click", endPress);
    window.addEventListener("pointercancel", endPress);
    return () => {
      window.removeEventListener("click", endPress);
      window.removeEventListener("pointercancel", endPress);
    };
  }, [keepOpenOnPress]);

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) {
      setHoverOpen(true);
      return;
    }
    if (pressingRef.current) return;
    setHoverOpen(false);
  }, []);

  const controlled = keepOpenOnPress
    ? { open: hoverOpen, onOpenChange: handleOpenChange }
    : {};

  return (
    <TooltipProvider delayDuration={0}>
      <KitTooltip {...controlled}>
        <TooltipTrigger asChild>
          <span
            className={className}
            // Capture phase: the primitive raises its close request from its
            // own pointer-down handler on the inner trigger, which in the
            // bubble phase would run before this one and close first.
            onPointerDownCapture={keepOpenOnPress
              ? () => {
                pressingRef.current = true;
              }
              : undefined}
            onPointerEnter={keepOpenOnPress ? () => setHoverOpen(true) : undefined}
            onPointerLeave={keepOpenOnPress
              ? () => {
                pressingRef.current = false;
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
