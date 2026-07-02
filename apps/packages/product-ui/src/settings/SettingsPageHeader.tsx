import { type ReactNode } from "react";

export interface SettingsPageHeaderProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/**
 * Flat settings page header (CONTRACT §3): page title at 20px/600 with -0.012em
 * tracking, optional 12px muted description, optional right-aligned action.
 */
export function SettingsPageHeader({ title, description, action }: SettingsPageHeaderProps) {
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-title font-semibold tracking-[-0.012em] text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-ui-sm leading-[1.45] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </header>
  );
}
