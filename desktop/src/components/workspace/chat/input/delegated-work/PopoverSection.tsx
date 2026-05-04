import type { ReactNode } from "react";

export function PopoverSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="py-1">
      <div className="px-1.5 pb-1 text-[11px] font-medium text-muted-foreground">{title}</div>
      {children}
    </section>
  );
}
