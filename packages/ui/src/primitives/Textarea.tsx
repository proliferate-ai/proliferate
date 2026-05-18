import { forwardRef, type TextareaHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className = "", ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={twMerge(
          "min-h-24 w-full resize-none rounded-md border border-input bg-surface-control px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
