import type { ReactNode } from "react";

interface ToolActionDetailsPanelProps {
  children: ReactNode;
  className?: string;
}

export function ToolActionDetailsPanel({
  children,
  className = "",
}: ToolActionDetailsPanelProps) {
  return (
    <div
      className={`overflow-hidden rounded-md border border-border/60 bg-foreground/[0.04] ${className}`}
    >
      {children}
    </div>
  );
}
