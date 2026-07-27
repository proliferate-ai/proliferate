import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "../utils/tw-merge";

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  action?: ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  action,
  className = "",
  ...props
}: PageHeaderProps) {
  const renderedActions = actions ?? action;

  return (
    <div
      className={twMerge(
        "flex min-w-0 flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        {/* ui-foundation-escalation: page-title role resolved to text-title
            (19px/24px), the closed ramp's largest heading rung, matching
            origin/ui-foundation-pass's prior-art choice for this component.
            This is a visible ~12px shrink from the pre-migration 31px/34px
            calc() literal (itself anchored on the now-deleted --text-xl
            ladder) — flagged for founder review at the checkpoint rather
            than silently absorbed, since no enumerated retune specifically
            authorizes a page-title rung. */}
        <h1 className="text-title font-semibold tracking-normal text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-body text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {renderedActions ? (
        <div className="flex shrink-0 items-center gap-2">{renderedActions}</div>
      ) : null}
    </div>
  );
}
