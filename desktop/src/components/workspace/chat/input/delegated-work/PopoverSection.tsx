import type { ReactNode } from "react";

export function PopoverSection({
  title,
  showTitle = true,
  children,
}: {
  title: string;
  showTitle?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="py-0.5">
      {showTitle && (
        <div className="flex h-6 items-center px-2 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      )}
      {children}
    </section>
  );
}
