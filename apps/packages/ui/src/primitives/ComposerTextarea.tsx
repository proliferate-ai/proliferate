import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Textarea } from "./Textarea";

type ComposerTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// UX_SPEC §5: chat-scale text with codex's font+8 leading, placeholder
// --muted-foreground at 75%.
const COMPOSER_TEXTAREA_CLASSNAME =
  "min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[length:var(--text-chat,12px)] leading-[calc(var(--text-chat,12px)+8px)] text-foreground shadow-none outline-none placeholder:text-[color:color-mix(in_oklab,var(--color-muted-foreground)_75%,transparent)] focus:ring-0";

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
