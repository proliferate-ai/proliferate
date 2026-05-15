import type { ReactNode } from "react";

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function SettingsPageHeader({
  title,
  description,
  action,
}: SettingsPageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-[1.375rem] font-medium leading-7 text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-5 text-foreground-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
    </header>
  );
}
