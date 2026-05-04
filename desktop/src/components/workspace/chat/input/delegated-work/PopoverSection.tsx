import type { ReactNode } from "react";

export function PopoverSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1 py-1">
      <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </section>
  );
}
