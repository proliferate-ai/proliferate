import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function SectionHeader({
  title,
  description,
  actions,
  className = "",
  ...props
}: SectionHeaderProps) {
  return (
    <div className={twMerge("flex items-start justify-between gap-3", className)} {...props}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
