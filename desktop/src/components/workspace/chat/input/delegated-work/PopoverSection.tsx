import type { ReactNode } from "react";

export function PopoverSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string | null;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex h-7 items-center justify-between gap-2 px-2">
        <span className="text-xs font-medium text-foreground">{title}</span>
        {detail ? (
          <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
