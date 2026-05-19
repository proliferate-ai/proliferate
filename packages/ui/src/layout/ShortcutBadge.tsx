import { type HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

interface ShortcutBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
}

export function ShortcutBadge({ label, className = "", ...props }: ShortcutBadgeProps) {
  return (
    <span
      className={twMerge(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-background px-1.5 font-mono text-[10px] leading-none text-muted-foreground",
        className,
      )}
      {...props}
    >
      {label}
    </span>
  );
}
