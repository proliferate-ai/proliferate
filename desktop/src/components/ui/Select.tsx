import { forwardRef, type SelectHTMLAttributes } from "react";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className = "", children, ...props }, ref) {
    const base =
      "w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground disabled:opacity-60";

    return (
      <select ref={ref} className={`${base} ${className}`} {...props}>
        {children}
      </select>
    );
  },
);
