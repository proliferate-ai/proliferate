import type { ReactNode } from "react";

interface ToolActionDetailsPanelProps {
  children: ReactNode;
  className?: string;
}

// Shared wrapper card used by tool-call detail bodies.
export function ToolActionDetailsPanel({
  children,
  className = "",
}: ToolActionDetailsPanelProps) {
  return (
    <div
      className={`overflow-hidden rounded-md border border-border/60 bg-surface-elevated-secondary ${className}`}
    >
      {children}
    </div>
  );
}
