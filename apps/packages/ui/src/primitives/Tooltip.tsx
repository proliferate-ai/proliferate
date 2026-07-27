import { useState, type ReactNode } from "react";
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
   * out on every press.
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
  // Pointer enter/leave on the trigger wrapper is the only thing that closes
  // this tooltip. The primitive's own close requests are ignored because
  // pointer-down is one of them: honoring it is exactly the blink-on-click
  // being fixed. Open requests still pass through, so keyboard focus opens it
  // the usual way.
  const controlled = keepOpenOnPress
    ? {
      open: hoverOpen,
      onOpenChange: (next: boolean) => {
        if (next) setHoverOpen(true);
      },
    }
    : {};

  return (
    <TooltipProvider delayDuration={0}>
      <KitTooltip {...controlled}>
        <TooltipTrigger asChild>
          <span
            className={className}
            onPointerEnter={keepOpenOnPress ? () => setHoverOpen(true) : undefined}
            onPointerLeave={keepOpenOnPress ? () => setHoverOpen(false) : undefined}
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
