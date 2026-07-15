import { forwardRef, type HTMLAttributes } from "react";
import { twMerge } from "../utils/tw-merge";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "info"
  | "warning"
  | "destructive"
  | "sidebar";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border bg-accent text-muted-foreground",
  accent: "border-border/70 bg-accent text-accent-foreground",
  success: "border-success/25 bg-success/10 text-success",
  info: "border-info/25 bg-info/10 text-info",
  warning: "border-warning/30 bg-warning/10 text-warning",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  sidebar: "border-sidebar-border bg-sidebar-accent text-sidebar-muted-foreground",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  function Badge({ tone = "neutral", className = "", ...props }, ref) {
    return (
      <span
        ref={ref}
        className={twMerge(
          "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-base font-medium",
          toneClasses[tone],
          className,
        )}
        {...props}
      />
    );
  },
);
