import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export interface SettingsEmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Compact placeholders (e.g. admin gates) sit inside a pane; full-height states fill it. */
  size?: "compact" | "full";
  className?: string;
}

/**
 * Flat empty/message state (CONTRACT §6): centered block on the page background —
 * no card. Optional 22px muted icon, 13px/medium title, 12px muted description
 * capped at 48ch, optional action below.
 */
export function SettingsEmptyState({
  icon,
  title,
  description,
  action,
  size = "full",
  className,
}: SettingsEmptyStateProps) {
  return (
    <div
      className={twMerge(
        "flex flex-col items-center justify-center gap-2 text-center",
        size === "full" ? "min-h-[280px] px-6 py-16" : "py-8",
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex items-center justify-center text-muted-foreground [&>svg]:size-[22px]">
          {icon}
        </div>
      ) : null}
      <div className="text-ui font-medium leading-5 text-foreground">{title}</div>
      {description ? (
        <div className="max-w-[48ch] text-ui-sm leading-[1.45] text-muted-foreground">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
