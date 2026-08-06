import type { ComponentPropsWithoutRef } from "react";

import { twMerge } from "#product/primitives/utils/tw-merge";

interface ShortcutBadgeProps extends ComponentPropsWithoutRef<"kbd"> {
  label: string;
}

export function ShortcutBadge({
  label,
  className = "",
  ...props
}: ShortcutBadgeProps) {
  return (
    <kbd
      {...props}
      className={twMerge(
        "inline-flex min-h-3.5 items-center justify-center rounded-md border-0 bg-current/10 px-1 py-[1px] font-sans text-ui-sm leading-3 text-current shadow-none",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
