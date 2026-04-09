import { forwardRef, type InputHTMLAttributes } from "react";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className = "", ...props }, ref) {
    const base = "rounded border-input";

    return (
      <input
        ref={ref}
        type="checkbox"
        className={`${base} ${className}`}
        {...props}
      />
    );
  },
);
