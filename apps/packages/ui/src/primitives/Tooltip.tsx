import type { ReactNode } from "react";
import {
  Tooltip as KitTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../kit/Tooltip";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  singleLine?: boolean;
}

export function Tooltip({
  content,
  children,
  className = "inline-flex shrink-0",
  singleLine = false,
}: TooltipProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <KitTooltip>
        <TooltipTrigger asChild>
          <span className={className}>{children}</span>
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
              ? "z-[70] max-w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden text-ellipsis whitespace-nowrap rounded-full"
              : "z-[70] overflow-hidden rounded-lg text-left"
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
