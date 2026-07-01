import type { ReactNode } from "react";

export function AgentDefaultsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{title}</h2>
        {description ? (
          <p className="text-sm leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
