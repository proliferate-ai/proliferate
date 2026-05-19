import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export interface SettingsCardRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

export function SettingsCardRow({
  label,
  description,
  children,
  className = "",
  ...props
}: SettingsCardRowProps) {
  return (
    <div
      className={twMerge(
        "flex min-h-[3.75rem] flex-col gap-3 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <div className="max-w-xl text-xs leading-4 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}
