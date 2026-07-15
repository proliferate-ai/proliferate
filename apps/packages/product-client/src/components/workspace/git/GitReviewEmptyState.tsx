import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";

/**
 * Quiet empty/placeholder state for the review document. Codex-style: plain
 * muted text, no icon tile or bordered chrome. An optional small icon renders
 * inline beside the title (used by per-file states for the loading spinner).
 */
export function GitReviewEmptyState({
  icon,
  title,
  description,
  action,
  variant = "panel",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "panel" | "inline";
}) {
  const isPanel = variant === "panel";

  return (
    <div
      className={
        isPanel
          ? "flex min-h-[200px] items-center justify-center px-4 py-8"
          : "flex min-h-20 items-center justify-center px-4 py-4"
      }
    >
      <div
        className={`flex w-full flex-col items-center text-center ${
          isPanel ? "max-w-[280px]" : "max-w-[260px]"
        }`}
      >
        <p className="flex items-center gap-1.5 text-ui text-sidebar-foreground/90">
          {icon && (
            <span aria-hidden="true" className="flex shrink-0 items-center text-sidebar-muted-foreground">
              {icon}
            </span>
          )}
          {title}
        </p>
        {description && (
          <p className="mt-0.5 text-pretty text-ui-sm leading-[var(--text-ui-sm--line-height)] text-sidebar-muted-foreground">
            {description}
          </p>
        )}
        {action && (
          <div className="mt-2">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

export function GitReviewEmptyStateAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-6 gap-1 rounded-md px-2 text-ui text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {children}
    </Button>
  );
}
