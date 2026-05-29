import { forwardRef, type SelectHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className = "", children, ...props }, ref) {
    const base =
      "h-9 w-full rounded-md border border-input bg-surface-control px-3 text-sm text-foreground outline-none transition-colors hover:bg-list-hover focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

    return (
      <select ref={ref} className={twMerge(base, className)} {...props}>
        {children}
      </select>
    );
  },
);
