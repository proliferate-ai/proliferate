import { forwardRef, type ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

interface ToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  function Toggle({ pressed = false, className = "", children, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={pressed}
        data-state={pressed ? "on" : "off"}
        className={twMerge(
          "inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
          pressed
            ? "border-border bg-accent text-foreground"
            : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
