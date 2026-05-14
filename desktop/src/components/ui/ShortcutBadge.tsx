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
        "inline-flex items-center justify-center rounded-md border-0 bg-current/10 px-1.5 py-0.5 font-sans text-[11px] leading-none text-current shadow-none",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
