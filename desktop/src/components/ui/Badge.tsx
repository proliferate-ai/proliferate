import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "destructive";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: BadgeTone;
}

const toneClassNames: Record<BadgeTone, string> = {
  neutral: "border-border/60 bg-foreground/5 text-muted-foreground",
  accent: "border-border/70 bg-accent text-accent-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning-border bg-warning text-warning-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function Badge({
  children,
  className = "",
  tone = "neutral",
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={`inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${toneClassNames[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
