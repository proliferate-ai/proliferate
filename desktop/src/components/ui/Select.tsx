import { forwardRef, type SelectHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";
import { ChevronUpDown } from "@/components/ui/icons";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className = "", children, ...props }, ref) {
    const base =
      "block h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm text-foreground shadow-none outline-none transition-colors hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

    return (
      <span className="relative block w-full">
        <select ref={ref} className={twMerge(base, className)} {...props}>
          {children}
        </select>
        <ChevronUpDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </span>
    );
  },
);
