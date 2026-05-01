import type { ReactNode } from "react";

interface DelegatedWorkComposerPanelProps {
  children: ReactNode;
}

export function DelegatedWorkComposerPanel({ children }: DelegatedWorkComposerPanelProps) {
  return (
    <div
      className="flex min-w-0 items-center rounded-t-2xl border-x border-t border-border/60 bg-background/70 px-2 py-1.5 backdrop-blur-sm"
      data-telemetry-mask
      aria-label="Delegated work"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {children}
      </div>
    </div>
  );
}
