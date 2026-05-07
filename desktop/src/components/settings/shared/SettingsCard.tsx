import type { ReactNode } from "react";

interface SettingsCardProps {
  children: ReactNode;
  className?: string;
}

export function SettingsCard({ children, className = "" }: SettingsCardProps) {
  return (
    <div
      className={`flex flex-col divide-y divide-border/40 rounded-lg border border-border bg-card/50 ${className}`}
    >
      {children}
    </div>
  );
}
