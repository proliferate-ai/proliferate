import type { ReactNode } from "react";

interface SettingsCardProps {
  children: ReactNode;
  className?: string;
}

export function SettingsCard({ children, className = "" }: SettingsCardProps) {
  return (
    <div
      className={`flex flex-col divide-y divide-border-light rounded-lg border border-border-light bg-surface-elevated shadow-[0_1px_2px_rgba(0,0,0,0.035)] ${className}`}
    >
      {children}
    </div>
  );
}
