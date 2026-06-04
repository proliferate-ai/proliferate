import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Textarea } from "./Textarea";

type ComposerTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const COMPOSER_TEXTAREA_CLASSNAME =
  "min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[length:0.75rem] leading-[1rem] text-foreground shadow-none outline-none placeholder:text-[color:color-mix(in_oklab,var(--color-faint)_50%,transparent)] focus:ring-0";

export const ComposerTextarea = forwardRef<HTMLTextAreaElement, ComposerTextareaProps>(
  function ComposerTextarea({ className = "", ...props }, ref) {
    return (
      <Textarea
        {...props}
        ref={ref}
        className={`${COMPOSER_TEXTAREA_CLASSNAME} ${className}`}
      />
    );
  },
);
