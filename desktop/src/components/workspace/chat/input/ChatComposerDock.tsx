import type { HTMLAttributes, ReactNode } from "react";

interface ChatComposerDockProps extends HTMLAttributes<HTMLDivElement> {
  backdrop?: boolean;
  topSlot?: ReactNode;
  footerSlot?: ReactNode;
  children: ReactNode;
}

/**
 * Shared dock shell for the composer area. Renders:
 *   1. optional backdrop wrapper (blur + scrim) so the composer looks
 *      layered over the transcript scroll
 *   2. a padded max-width column
 *   3. an optional inset top-slot region (narrower than the composer)
 *   4. children — usually `<ChatInput />` or a playground surface
 *
 * Consumed by `ChatView` (production) and `ChatPlaygroundPage` (dev) so
 * both surfaces stay in sync automatically.
 */
export function ChatComposerDock({
  backdrop = true,
  topSlot,
  footerSlot,
  children,
  className = "",
  ...rest
}: ChatComposerDockProps) {
  return (
    <div className={`relative z-10 mt-auto shrink-0 ${backdrop ? "bg-background/88 pt-2 backdrop-blur-xl" : ""}`}>
      {backdrop && (
        <div className="pointer-events-none absolute inset-x-0 -top-8 h-10 bg-gradient-to-b from-transparent via-background/45 to-background/95" />
      )}
      <div className={`relative px-4 pb-4 ${className}`} {...rest}>
        <div className="relative mx-auto max-w-3xl @container">
          {topSlot && (
            <div className="relative flex flex-col px-5">{topSlot}</div>
          )}
          {children}
          {footerSlot ? (
            <div className="mt-2">{footerSlot}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
