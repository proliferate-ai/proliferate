import { type ReactNode } from "react";

export interface SettingsPageHeaderProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function SettingsPageHeader({
  title,
  description,
  action,
}: SettingsPageHeaderProps) {
  return (
    <header className="flex min-h-[4.25rem] flex-col gap-2 pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-[length:calc(var(--text-xl)_+_0.875rem)] font-semibold leading-[calc(var(--text-xl--line-height)_+_0.5rem)] tracking-normal text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </header>
  );
}
