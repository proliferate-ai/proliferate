import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

interface ToolActionDetailsPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * The one detail-body shell behind every expanded tool call. Matches the chat
 * code-block card surface so expanded tool output and fenced code read as one
 * family; the transparent border keeps size parity with bordered cards.
 */
export function ToolActionDetailsPanel({
  children,
  className,
  ...props
}: ToolActionDetailsPanelProps) {
  return (
    <div
      {...props}
      className={twMerge(
        "overflow-clip rounded-lg border border-transparent bg-[var(--color-code-block-background,var(--color-card))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
