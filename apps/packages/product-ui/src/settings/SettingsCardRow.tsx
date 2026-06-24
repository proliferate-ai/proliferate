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
        "flex min-h-[3.75rem] flex-col gap-2.5 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold leading-5 tracking-normal text-foreground">{label}</div>
        {description ? (
          <div className="max-w-2xl text-sm leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center sm:justify-end">{children}</div> : null}
    </div>
  );
}
