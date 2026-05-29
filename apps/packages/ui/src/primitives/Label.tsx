import { type LabelHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className = "", children, ...props }: LabelProps) {
  const base = "text-xs text-muted-foreground mb-1 block";

  return (
    <label className={twMerge(base, className)} {...props}>
      {children}
    </label>
  );
}
