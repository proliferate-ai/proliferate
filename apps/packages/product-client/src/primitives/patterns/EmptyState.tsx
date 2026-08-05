import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  className = "",
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={twMerge(
        "flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center",
        className,
      )}
      {...props}
    >
      <h3 className="text-heading font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-ui-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
