import { forwardRef, type InputHTMLAttributes } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

type InputVariant = "default" | "unstyled";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant;
}

const variantClasses: Record<InputVariant, string> = {
  default:
    "h-9 w-full rounded-md border border-input bg-surface-control px-3 text-ui text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60",
  unstyled: "",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ className = "", variant = "default", ...props }, ref) {
    return (
      <input ref={ref} className={twMerge(variantClasses[variant], className)} {...props} />
    );
  },
);
