import { forwardRef, type ButtonHTMLAttributes } from "react";
import { twMerge } from "../utils/tw-merge";

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
          "inline-flex h-8 items-center justify-center rounded-md border px-3 text-ui font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
          pressed
            ? "border-border bg-selected text-foreground"
            : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
