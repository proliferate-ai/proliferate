import type { ReactNode } from "react";

interface SettingsCardRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function SettingsCardRow({
  label,
  description,
  children,
}: SettingsCardRowProps) {
  return (
    <div className="flex items-center justify-between gap-8 p-3">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
