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
        {/* ui-foundation-escalation: page-title role is a Workflow 2 decision.
            This heading rendered 31px/34px off the deleted --text-xl ladder
            (calc(--text-xl + 0.875rem) / calc(--text-xl--line-height + 0.5rem)).
            No enumerated retune covers a 31px page title, so Workflow 1 only
            re-anchors the same geometry on a surviving token — identical 31/34
            at the default preset, and it now tracks the reading ramp instead of
            the removed independent XL line-height ladder. Choosing the semantic
            role (text-title vs text-heading vs a new page-title rung) belongs to
            the consumer migration, against a cited reference capture. */}
        <h1 className="text-[length:calc(var(--text-body)_+_1.125rem)] font-semibold leading-[calc(var(--text-body--line-height)_+_0.875rem)] tracking-normal text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
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
