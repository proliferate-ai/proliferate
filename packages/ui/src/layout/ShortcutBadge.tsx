import { type HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

interface ShortcutBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
}

export function ShortcutBadge({ label, className = "", ...props }: ShortcutBadgeProps) {
  return (
    <span
      className={twMerge(
        "inline-flex min-h-3.5 items-center justify-center rounded-md border-0 bg-current/10 px-1 py-[1px] font-sans text-[10px] leading-3 text-current shadow-none",
        className,
      )}
      {...props}
    >
      {label}
    </span>
  );
}
