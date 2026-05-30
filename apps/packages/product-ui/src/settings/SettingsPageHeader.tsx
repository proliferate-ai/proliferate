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
    <header className="flex min-h-[3.75rem] flex-col gap-2 border-b border-border-light pb-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-lg font-normal text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
