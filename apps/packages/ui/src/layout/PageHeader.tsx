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
        <h1 className="text-[length:calc(var(--text-xl)_+_0.875rem)] font-semibold leading-[calc(var(--text-xl--line-height)_+_0.5rem)] tracking-normal text-foreground">{title}</h1>
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
