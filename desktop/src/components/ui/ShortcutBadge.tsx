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
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-current/10 px-1.5 font-sans text-[10px] font-medium leading-none text-current shadow-none",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
