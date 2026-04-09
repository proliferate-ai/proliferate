import { type LabelHTMLAttributes } from "react";

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className = "", children, ...props }: LabelProps) {
  const base = "text-xs text-muted-foreground mb-1 block";

  return (
    <label className={`${base} ${className}`} {...props}>
      {children}
    </label>
  );
}
