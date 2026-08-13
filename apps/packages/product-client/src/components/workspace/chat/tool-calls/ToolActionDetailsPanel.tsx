import type { HTMLAttributes, ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

interface ToolActionDetailsPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * The one detail-body shell behind every expanded tool call.
 *
 * Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review, check 1): this
 * is the shape `Card` names, but `Card`'s tint surface is deliberately
 * borderless and this panel needs the `border-border/60` hairline to separate
 * itself from the transcript's own tint at close range. Composing `Card` and
 * repainting the edge from here would be the paint leak the doctrine closes, so
 * the shell stays local until `Card` can express a bordered tint.
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
        "overflow-hidden rounded-md border border-border/60 bg-surface-elevated-secondary",
        className,
      )}
    >
      {children}
    </div>
  );
}
