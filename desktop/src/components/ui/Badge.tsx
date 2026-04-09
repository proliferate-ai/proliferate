import type { HTMLAttributes, ReactNode } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function Badge({ children, className = "", ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-md border border-border/50 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}
