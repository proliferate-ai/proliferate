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
    <div className="flex min-h-[3.75rem] items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="max-w-[28rem] text-xs leading-4 text-foreground-secondary">{description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
