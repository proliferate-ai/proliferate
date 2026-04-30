import type { ReactNode } from "react";

interface SettingsEditorRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}

export function SettingsEditorRow({
  label,
  description,
  children,
}: SettingsEditorRowProps) {
  return (
    <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] md:items-start">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
