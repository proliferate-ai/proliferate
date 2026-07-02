import { twMerge } from "tailwind-merge";

interface ShortcutBadgeProps {
  label: string;
  className?: string;
}

export function ShortcutBadge({
  label,
  className = "",
}: ShortcutBadgeProps) {
  return (
    <kbd
      className={twMerge(
        "inline-flex min-h-3.5 items-center justify-center rounded-md border-0 bg-current/10 px-1 py-[1px] font-sans text-sm leading-3 text-current shadow-none",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
