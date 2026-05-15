import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Textarea } from "@/components/ui/Textarea";

type ComposerTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const COMPOSER_TEXTAREA_CLASSNAME =
  "min-h-0 px-0 py-0 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-foreground placeholder:text-[color:var(--color-composer-control-muted-foreground)]";

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
