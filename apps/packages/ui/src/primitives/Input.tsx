import { forwardRef, type InputHTMLAttributes } from "react";
import { twMerge } from "../utils/tw-merge";

type InputVariant = "default" | "unstyled";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant;
}

const variantClasses: Record<InputVariant, string> = {
  // Quiet field: a near-background translucent fill + the same hairline our
  // cards use, so inputs sit calmly on any dark surface instead of reading as
  // a raised gray box. Focus is a single clean ring.
  default:
    "w-full h-9 px-3 rounded-md border border-border bg-surface-elevated-secondary text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-border-heavy focus:outline-none focus:border-border-heavy focus:ring-1 focus:ring-ring disabled:opacity-60",
  unstyled: "",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ className = "", variant = "default", ...props }, ref) {
    return (
      <input ref={ref} className={twMerge(variantClasses[variant], className)} {...props} />
    );
  },
);
