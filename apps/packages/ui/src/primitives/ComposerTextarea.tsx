import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Textarea } from "./Textarea";

type ComposerTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// UX_SPEC §5 + owner rev 2026-07-01: the input reads LARGER than the 13px
// composer controls (codex hierarchy: input > controls). 14px with codex's
// font+8 leading; placeholder --muted-foreground at 55% so it sits well below
// typed text in both mono dark and light themes.
const COMPOSER_TEXTAREA_CLASSNAME =
  "min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-composer text-foreground shadow-none outline-none placeholder:text-[color:color-mix(in_oklab,var(--color-muted-foreground)_55%,transparent)] focus:ring-0";

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
