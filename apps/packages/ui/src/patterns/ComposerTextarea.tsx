import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Textarea } from "../primitives/Textarea";

type ComposerTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// UX_SPEC §5 + owner rev 2026-07-01: the input reads LARGER than the 13px
// composer controls (our type hierarchy: input > controls), with a font+8
// leading.
//
// ui-foundation-escalation: [CHAT-03] rules composer placeholders onto the
// tertiary role rather than "ad-hoc alpha mixes", so the placeholder ink is
// `--color-foreground-tertiary` (50%) instead of the old
// `text-muted-foreground/55` (70% x 55% = 38.5% effective). That is a small step
// UP in contrast, chosen because the ruled vocabulary has no
// placeholder-specific role and 50% is the closest legal match to our
// ~49.8% tertiary target — the compounded placeholder mechanism
// (placeholder-foreground x opacity .5, ~25-35%) is not expressible here. See
// ui-foundation-chat-addendum.md [CHAT-03]. It still sits well below typed text
// (`text-foreground`) in both mono dark and light.
const COMPOSER_TEXTAREA_CLASSNAME =
  "min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-composer text-foreground shadow-none outline-none placeholder:text-foreground-tertiary focus:ring-0";

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
