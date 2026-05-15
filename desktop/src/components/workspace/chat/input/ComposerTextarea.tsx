import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Textarea } from "@/components/ui/Textarea";

type ComposerTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const COMPOSER_TEXTAREA_CLASSNAME =
  "min-h-0 px-0 py-0 text-[length:0.6875rem] leading-[1.125rem] text-foreground placeholder:text-[color:color-mix(in_oklab,var(--color-faint)_50%,transparent)]";

export const ComposerTextarea = forwardRef<HTMLTextAreaElement, ComposerTextareaProps>(
  function ComposerTextarea({ className = "", ...props }, ref) {
    return (
      <Textarea
        {...props}
        ref={ref}
        variant="ghost"
        className={`${COMPOSER_TEXTAREA_CLASSNAME} ${className}`}
      />
    );
  },
);
