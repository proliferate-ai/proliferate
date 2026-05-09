import type { ReactNode } from "react";

interface PublishSectionProps {
  children: ReactNode;
  flush?: boolean;
}

export function PublishSection({ children, flush = false }: PublishSectionProps) {
  return (
    <section className={flush ? "space-y-3" : "space-y-3 border-t border-border/60 pt-4"}>
      {children}
    </section>
  );
}
