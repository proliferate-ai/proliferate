import { type LabelHTMLAttributes } from "react";
import { twMerge } from "../utils/tw-merge";

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className = "", children, ...props }: LabelProps) {
  const base = "mb-1 block text-ui-sm text-muted-foreground";

  return (
    <label className={twMerge(base, className)} {...props}>
      {children}
    </label>
  );
}
