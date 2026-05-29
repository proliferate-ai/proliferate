import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";

export function GitReviewEmptyState({
  icon,
  title,
  description,
  action,
  variant = "panel",
}: {
  icon: ReactNode;
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
          ? "flex min-h-[260px] items-center justify-center px-4 py-8"
          : "flex min-h-28 items-center justify-center px-4 py-5"
      }
    >
      <div
        className={`flex w-full flex-col items-center text-center ${
          isPanel ? "max-w-[300px]" : "max-w-[260px]"
        }`}
      >
        <div
          className={`mb-3 flex items-center justify-center rounded-lg border border-sidebar-border/70 bg-sidebar-accent/45 text-sidebar-muted-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-foreground)_7%,transparent)] ${
            isPanel ? "size-10" : "size-8"
          }`}
        >
          {icon}
        </div>
        <p
          className={`font-medium text-sidebar-foreground ${
            isPanel ? "text-sm" : "text-xs"
          }`}
        >
          {title}
        </p>
        {description && (
          <p className="mt-1 text-pretty text-xs leading-5 text-sidebar-muted-foreground">
            {description}
          </p>
        )}
        {action && (
          <div className={isPanel ? "mt-4" : "mt-3"}>
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
      className="h-7 gap-1.5 rounded-md border border-sidebar-border/70 bg-sidebar-background/40 px-2.5 text-xs text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {children}
    </Button>
  );
}
